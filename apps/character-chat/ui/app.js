const resourceBase = '/api/apps/character-chat/resources';

const state = {
  characters: [],
  selectedCharacter: null,
  stories: [],
  memoryEntries: [],
  conversation: null,
  userSettings: null,
  editingCharacter: null,
  iconUrl: '',
  speakerId: '',
  sending: false,
  runId: null,
  participantChoiceId: '',
};

const $ = (id) => document.getElementById(id);
const asList = (value) => Array.isArray(value) ? value : (value ? [value] : []);

async function api(path = '', options = {}) {
  const { timeoutMs = 0, ...fetchOptions } = options;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${resourceBase}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
      ...fetchOptions,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || '通信に失敗しました');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('会話の読み込みがタイムアウトしました。Tailscale接続を確認して再試行してください。');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function findCharacter(id) {
  return state.characters.find((item) => item.id === id);
}

function participants() {
  return state.conversation?.participants || (state.selectedCharacter ? [state.selectedCharacter] : []);
}

function createAvatar(item, className = '') {
  const node = document.createElement('div');
  node.className = `avatar ${className}`.trim();
  if (item?.iconUrl) {
    const image = document.createElement('img');
    image.className = 'avatar-image';
    image.src = item.iconUrl;
    image.alt = '';
    image.loading = 'lazy';
    node.append(image);
  } else {
    node.textContent = item?.icon || '✦';
  }
  return node;
}

function renderAvatar(target, item, className = '') {
  const avatar = createAvatar(item, className);
  target.className = avatar.className;
  target.replaceChildren(...avatar.childNodes);
}

function closeDialog(event) {
  event.currentTarget.closest('dialog')?.close('cancel');
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value ?? '';
}

function drawCharacters() {
  const list = $('character-list');
  list.replaceChildren();
  for (const character of state.characters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `character-card ${state.selectedCharacter?.id === character.id ? 'active' : ''}`;
    button.append(createAvatar(character));
    const copy = document.createElement('span');
    copy.className = 'character-copy';
    const name = document.createElement('strong');
    name.textContent = character.name;
    const description = document.createElement('span');
    description.textContent = character.description || '設定を追加して会話を始める';
    copy.append(name, description);
    if (character.isDefault) {
      const badge = document.createElement('small');
      badge.className = 'default-badge';
      badge.textContent = 'デフォルト';
      copy.append(badge);
    }
    button.append(copy);
    button.addEventListener('click', () => chooseCharacter(character.id));
    list.append(button);
  }
  const canModify = !!state.selectedCharacter && !state.selectedCharacter.isDefault;
  $('edit-character').disabled = !canModify;
  $('delete-character').disabled = !canModify;
  $('edit-character').title = state.selectedCharacter?.isDefault ? 'デフォルトキャラクターは編集できません' : '';
  $('delete-character').title = state.selectedCharacter?.isDefault ? 'デフォルトキャラクターは削除できません' : '';
}

function drawStories() {
  const list = $('story-list');
  list.replaceChildren();
  if (!state.stories.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = 'まだStoryがありません';
    list.append(empty);
    return;
  }
  for (const story of state.stories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `story-card ${state.conversation?.id === story.id ? 'active' : ''}`;
    const title = document.createElement('strong');
    title.textContent = story.title;
    const meta = document.createElement('span');
    const date = story.updatedAt ? new Date(story.updatedAt).toLocaleDateString('ja-JP') : '';
    meta.textContent = `${story.genre || '新しい会話'}${date ? ` · ${date}` : ''}`;
    button.append(title, meta);
    button.addEventListener('click', () => openConversation(story.id).catch(showConversationError));
    list.append(button);
  }
}

function updateComposerHint() {
  const speaker = findCharacter(state.speakerId);
  setText('compose-hint', `${speaker?.name || 'キャラクター'}が返答　·　Enterで送信　·　Shift + Enterで改行`);
}

function drawParticipants() {
  const list = $('participant-chips');
  list.replaceChildren();
  for (const character of participants()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `participant-chip ${state.speakerId === character.id ? 'active' : ''}`;
    button.title = '次の返答役にする';
    button.append(createAvatar(character), document.createTextNode(character.name));
    button.addEventListener('click', () => {
      state.speakerId = character.id;
      drawParticipants();
    });
    list.append(button);
  }
  updateComposerHint();
}

function drawMessages() {
  const list = $('messages');
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of state.conversation?.messages || []) {
    const character = item.characterId ? findCharacter(item.characterId) : state.selectedCharacter;
    const row = document.createElement('article');
    row.className = `message-row ${item.role === 'user' ? 'user' : 'assistant'}`;
    row.dataset.messageId = item.id;
    const label = document.createElement('div');
    label.className = 'message-label';
    const name = document.createElement('span');
    name.textContent = item.role === 'user' ? (state.userSettings?.displayName || 'あなた') : (character?.name || 'キャラクター');
    const speakerAvatar = item.role === 'user'
      ? createAvatar({ icon: '👤' }, 'message-avatar user-avatar')
      : createAvatar(character, 'message-avatar');
    label.append(speakerAvatar, name);
    if (item.createdAt) {
      const time = document.createElement('time');
      time.textContent = new Date(item.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      label.append(time);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = item.content;
    row.append(label, bubble);
    if (item.role === 'assistant') {
      const tools = document.createElement('div');
      tools.className = 'message-tools';
      const regenerate = document.createElement('button');
      regenerate.type = 'button';
      regenerate.textContent = '↻ 再生成';
      regenerate.addEventListener('click', () => startRun({ targetMessageId: item.id }));
      const instruct = document.createElement('button');
      instruct.type = 'button';
      instruct.textContent = '＋ 追加指示';
      instruct.addEventListener('click', () => askAdditionalInstruction(item.id));
      const remember = document.createElement('button');
      remember.type = 'button';
      remember.textContent = '＋ 記憶に追加';
      remember.addEventListener('click', () => openMemoryDialog(item.content).catch(showConversationError));
      tools.append(regenerate, instruct, remember);
      row.append(tools);
    }
    fragment.append(row);
  }
  list.append(fragment);
  list.scrollTop = list.scrollHeight;
}

function setChatVisible(visible) {
  $('empty-state').hidden = visible;
  $('chat-view').hidden = !visible;
}

function renderConversationShell() {
  if (!state.conversation) return;
  setChatVisible(true);
  $('retry-conversation').hidden = true;
  setText('conversation-title', state.conversation.title || '新しいStory');
  setText('conversation-description', state.conversation.plotDescription || 'このStoryの会話');
  setText('story-badge', state.conversation.genre || 'STORY');
  renderAvatar($('active-character-icon'), state.selectedCharacter, 'avatar-large');
  drawCharacters();
  drawStories();
  drawParticipants();
  drawMessages();
}

function showConversationError(error) {
  if (state.conversation) {
    renderConversationShell();
    setText('conversation-description', `履歴の読み込みに失敗しました：${error.message}`);
  } else {
    setChatVisible(false);
  }
  setText('empty-state-title', '会話を開けませんでした');
  setText('empty-state-description', error.message);
  $('retry-conversation').hidden = false;
}

async function chooseCharacter(id) {
  const character = findCharacter(id);
  if (!character) return;
  state.selectedCharacter = character;
  state.conversation = null;
  state.speakerId = id;
  state.stories = [];
  drawCharacters();
  drawStories();
  setChatVisible(false);
  $('retry-conversation').hidden = true;
  setText('empty-state-title', '会話を読み込んでいます…');
  setText('empty-state-description', '');
  try {
    state.stories = asList(await api(`/characters/${id}/conversations`, { timeoutMs: 10000 }));
    drawStories();
    if (state.stories[0]) {
      state.conversation = { ...state.stories[0], participants: [character], messages: [] };
      renderConversationShell();
      await openConversation(state.stories[0].id);
    } else {
      await createStory(false);
    }
  } catch (error) {
    showConversationError(error);
  }
}

async function openConversation(id) {
  const conversation = await api(`/conversations/${id}`, { timeoutMs: 10000 });
  state.conversation = conversation;
  state.selectedCharacter = findCharacter(conversation.characterId) || state.selectedCharacter;
  state.speakerId = conversation.participants?.[0]?.id || state.selectedCharacter?.id || '';
  renderConversationShell();
}

async function createStory(ask = true) {
  if (!state.selectedCharacter) return;
  const defaultTitle = `${state.selectedCharacter.name}との会話`;
  const title = ask ? window.prompt('Storyのタイトル', defaultTitle) : defaultTitle;
  if (title === null) return;
  const created = await api('/conversations', { method: 'POST', body: JSON.stringify({ characterId: state.selectedCharacter.id, title: title.trim() || '新しいStory' }) });
  state.stories = asList(await api(`/characters/${state.selectedCharacter.id}/conversations`));
  await openConversation(created.id);
}

async function deleteStory() {
  if (!state.conversation || !window.confirm(`「${state.conversation.title}」を会話履歴ごと削除しますか？`)) return;
  await api(`/conversations/${state.conversation.id}`, { method: 'DELETE' });
  state.conversation = null;
  state.stories = asList(await api(`/characters/${state.selectedCharacter.id}/conversations`));
  drawStories();
  setChatVisible(false);
  setText('empty-state-title', 'Storyを削除しました');
  setText('empty-state-description', '新しいStoryを作成して会話を始められます。');
  if (state.stories[0]) await openConversation(state.stories[0].id);
}

function openCharacterForm(character = null) {
  if (character?.isDefault) return;
  state.editingCharacter = character;
  state.iconUrl = character?.iconUrl || '';
  setText('character-dialog-title', character ? 'キャラクターを編集' : 'キャラクターを作成');
  $('character-name').value = character?.name || '';
  $('character-description').value = character?.description || '';
  $('character-prompt').value = character?.systemPrompt || '';
  $('character-greeting').value = character?.greeting || '';
  renderIconPreview();
  setText('icon-generation-status', '');
  showDialog($('character-dialog'));
}

function renderIconPreview() {
  const preview = $('icon-preview');
  preview.replaceChildren();
  if (state.iconUrl) {
    const image = document.createElement('img');
    image.src = state.iconUrl;
    image.alt = 'アイコン';
    preview.append(image);
  } else {
    preview.textContent = state.editingCharacter?.icon || '✦';
  }
}

async function generateIcon() {
  $('generate-icon').disabled = true;
  setText('icon-generation-status', 'キャラ設定からアイコンを生成中…');
  try {
    const result = await api('/icon-generation', { method: 'POST', body: JSON.stringify({ name: $('character-name').value, description: $('character-description').value, systemPrompt: $('character-prompt').value, greeting: $('character-greeting').value }) });
    state.iconUrl = result.iconUrl;
    renderIconPreview();
    setText('icon-generation-status', '生成しました。保存して使えます。');
  } catch (error) {
    setText('icon-generation-status', error.message);
  } finally {
    $('generate-icon').disabled = false;
  }
}

async function saveCharacter(event) {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  if (state.editingCharacter?.isDefault) return;
  const body = { name: $('character-name').value, icon: state.editingCharacter?.icon || '✦', iconUrl: state.iconUrl, description: $('character-description').value, systemPrompt: $('character-prompt').value, greeting: $('character-greeting').value };
  const saved = state.editingCharacter
    ? await api(`/characters/${state.editingCharacter.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    : await api('/characters', { method: 'POST', body: JSON.stringify(body) });
  $('character-dialog').close('save');
  state.characters = asList(await api('/characters'));
  state.selectedCharacter = findCharacter(saved.id) || state.selectedCharacter;
  drawCharacters();
  if (state.conversation) await openConversation(state.conversation.id);
  else if (state.selectedCharacter) await chooseCharacter(state.selectedCharacter.id);
}

async function deleteSelectedCharacter() {
  if (state.selectedCharacter?.isDefault) return;
  if (!state.selectedCharacter || !window.confirm(`「${state.selectedCharacter.name}」と関連するStoryを完全に削除しますか？`)) return;
  await api(`/characters/${state.selectedCharacter.id}`, { method: 'DELETE' });
  state.characters = asList(await api('/characters'));
  state.selectedCharacter = null;
  state.conversation = null;
  state.stories = [];
  drawCharacters();
  drawStories();
  setChatVisible(false);
  const requestedId = new URLSearchParams(location.search).get('character');
  const next = findCharacter(requestedId) || state.characters[0];
  if (next) await chooseCharacter(next.id);
}

function openPersona() {
  $('persona-name').value = state.userSettings?.displayName || '';
  $('persona-text').value = state.userSettings?.persona || '';
  showDialog($('persona-dialog'));
}

async function savePersona(event) {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  state.userSettings = await api('/settings', { method: 'PUT', body: JSON.stringify({ displayName: $('persona-name').value, persona: $('persona-text').value }) });
  $('persona-dialog').close('save');
  drawMessages();
}

function openStorySettings() {
  if (!state.conversation) return;
  $('story-title').value = state.conversation.title || '';
  $('story-plot').value = state.conversation.plotDescription || '';
  $('story-genre').value = state.conversation.genre || '';
  $('story-pov').value = state.conversation.pov || '二人称';
  $('story-pace').value = state.conversation.pace || '自然';
  showDialog($('story-dialog'));
}

async function saveStory(event) {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  state.conversation = await api(`/conversations/${state.conversation.id}/settings`, { method: 'PATCH', body: JSON.stringify({ title: $('story-title').value, plotDescription: $('story-plot').value, genre: $('story-genre').value, pov: $('story-pov').value, pace: $('story-pace').value }) });
  $('story-dialog').close('save');
  state.stories = asList(await api(`/characters/${state.selectedCharacter.id}/conversations`));
  await openConversation(state.conversation.id);
}

const memoryKindLabels = { summary: '自動要約', fact: '事実', relationship: '関係性', setting: '設定', goal: '目的・約束', preference: '好み' };

function resetMemoryForm(content = '') {
  $('memory-id').value = '';
  $('memory-kind').value = 'fact';
  $('memory-content').value = content;
}

function renderMemoryList() {
  const list = $('memory-list');
  list.replaceChildren();
  if (!state.memoryEntries.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = 'まだ記憶はありません。必要なものだけ追加できます。';
    list.append(empty);
    return;
  }
  for (const entry of state.memoryEntries) {
    const item = document.createElement('article');
    item.className = 'memory-note';
    const kind = document.createElement('span');
    kind.className = 'memory-kind';
    kind.textContent = memoryKindLabels[entry.kind] || entry.kind;
    const content = document.createElement('p');
    content.textContent = entry.content;
    const actions = document.createElement('div');
    actions.className = 'memory-note-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '編集';
    edit.addEventListener('click', () => {
      $('memory-id').value = entry.id;
      $('memory-kind').value = entry.kind;
      $('memory-content').value = entry.content;
      $('memory-content').focus();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '削除';
    remove.addEventListener('click', () => deleteMemory(entry.id).catch(showConversationError));
    actions.append(edit, remove);
    item.append(kind, content, actions);
    list.append(item);
  }
}

async function openMemoryDialog(prefill = '') {
  if (!state.conversation) return;
  state.memoryEntries = asList(await api(`/conversations/${state.conversation.id}/memory`));
  renderMemoryList();
  resetMemoryForm(prefill);
  showDialog($('memory-dialog'));
}

async function refreshStoryMemory() {
  if (!state.conversation) return;
  if (!window.confirm('このStoryによる記憶を更新しますか？\n会話全体をCodex CLIで要約し、自動要約を置き換えます。')) return;
  const button = $('memory-settings');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = '記憶を更新中…';
  try {
    const response = await fetch('/api/apps/character-chat/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'refresh_memory', conversationId: state.conversation.id }) });
    const run = await response.json();
    if (!response.ok) throw new Error(run?.error?.message || '記憶の更新を開始できませんでした');
    await new Promise((resolve, reject) => {
      const events = new EventSource(`/api/runs/${run.id}/events`);
      let settled = false;
      const finish = (callback, value) => { if (settled) return; settled = true; events.close(); callback(value); };
      events.addEventListener('run.completed', () => finish(resolve));
      events.addEventListener('run.failed', (event) => {
        const data = JSON.parse(event.data);
        finish(reject, new Error(data.error?.message || '記憶を更新できませんでした'));
      });
      events.onerror = () => finish(reject, new Error('記憶更新のストリーミング接続が切れました'));
    });
    await openConversation(state.conversation.id);
    window.alert('Storyの記憶を更新しました。');
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function saveMemory(event) {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  if (!state.conversation) return;
  const content = $('memory-content').value.trim();
  if (!content) return;
  const id = $('memory-id').value;
  const payload = { kind: $('memory-kind').value, content };
  if (id) {
    await api(`/conversations/${state.conversation.id}/memory/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    await api(`/conversations/${state.conversation.id}/memory`, { method: 'POST', body: JSON.stringify(payload) });
  }
  state.memoryEntries = asList(await api(`/conversations/${state.conversation.id}/memory`));
  state.conversation.memory = state.memoryEntries;
  renderMemoryList();
  resetMemoryForm();
}

async function deleteMemory(id) {
  if (!window.confirm('この記憶を削除しますか？')) return;
  await api(`/conversations/${state.conversation.id}/memory/${id}`, { method: 'DELETE' });
  state.memoryEntries = asList(await api(`/conversations/${state.conversation.id}/memory`));
  state.conversation.memory = state.memoryEntries;
  renderMemoryList();
  resetMemoryForm();
}

function openParticipants() {
  const current = participants().map((item) => item.id);
  const list = $('participant-list');
  list.replaceChildren();
  for (const character of participants()) {
    const row = document.createElement('div');
    row.className = 'participant-row';
    const label = document.createElement('span');
    label.append(createAvatar(character), document.createTextNode(character.name));
    row.append(label);
    if (character.id !== state.conversation.characterId) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '外す';
      remove.addEventListener('click', () => removeParticipant(character.id));
      row.append(remove);
    }
    list.append(row);
  }
  state.participantChoiceId = '';
  const choice = $('participant-choice-list');
  choice.replaceChildren();
  const available = state.characters.filter((item) => !current.includes(item.id));
  if (!available.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = '追加できるキャラクターはありません';
    choice.append(empty);
  }
  for (const character of available) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'participant-choice-card';
    option.append(createAvatar(character), document.createTextNode(character.name));
    option.addEventListener('click', () => {
      state.participantChoiceId = character.id;
      choice.querySelectorAll('.participant-choice-card').forEach((item) => item.classList.toggle('active', item === option));
    });
    choice.append(option);
  }
  showDialog($('participant-dialog'));
}

async function addParticipant(event) {
  if (event.submitter?.value !== 'add') return;
  event.preventDefault();
  const id = state.participantChoiceId;
  if (!id || !state.conversation) return;
  await api(`/conversations/${state.conversation.id}/participants`, { method: 'POST', body: JSON.stringify({ characterId: id }) });
  $('participant-dialog').close('add');
  await openConversation(state.conversation.id);
}

async function removeParticipant(id) {
  await api(`/conversations/${state.conversation.id}/participants/${id}`, { method: 'DELETE' });
  if ($('participant-dialog').open) $('participant-dialog').close();
  await openConversation(state.conversation.id);
}

function addPendingMessage() {
  const row = document.createElement('article');
  row.className = 'message-row assistant pending';
  const label = document.createElement('div');
  label.className = 'message-label';
  label.append(createAvatar(findCharacter(state.speakerId), 'message-avatar'), document.createTextNode('生成中…'));
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = '…';
  row.append(label, bubble);
  $('messages').append(row);
  $('messages').scrollTop = $('messages').scrollHeight;
  return bubble;
}

function finishSending() {
  state.sending = false;
  state.runId = null;
  $('stop-generation').hidden = true;
  $('message-input').disabled = false;
}

async function startRun({ message = '', targetMessageId = '', instruction = '' } = {}) {
  if (!state.conversation || state.sending || (!message && !targetMessageId)) return;
  state.sending = true;
  $('stop-generation').hidden = false;
  $('message-input').disabled = true;
  if (message) {
    const row = document.createElement('article');
    row.className = 'message-row user';
    const label = document.createElement('div');
    label.className = 'message-label';
    label.append(createAvatar({ icon: '👤' }, 'message-avatar user-avatar'), document.createTextNode(state.userSettings?.displayName || 'あなた'));
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = message;
    row.append(label, bubble);
    $('messages').append(row);
    $('messages').scrollTop = $('messages').scrollHeight;
  }
  const pendingBubble = addPendingMessage();
  try {
    const response = await fetch('/api/apps/character-chat/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: state.conversation.id, message, targetMessageId, instruction, speakerCharacterId: state.speakerId }) });
    const run = await response.json();
    if (!response.ok) throw new Error(run?.error?.message || '実行できません');
    state.runId = run.id;
    const events = new EventSource(`/api/runs/${run.id}/events`);
    events.addEventListener('message.delta', (event) => {
      const data = JSON.parse(event.data);
      pendingBubble.textContent = pendingBubble.textContent === '…' ? data.text : pendingBubble.textContent + data.text;
      $('messages').scrollTop = $('messages').scrollHeight;
    });
    events.addEventListener('run.completed', async () => {
      events.close();
      finishSending();
      await openConversation(state.conversation.id);
    });
    events.addEventListener('run.failed', (event) => {
      const data = JSON.parse(event.data);
      events.close();
      pendingBubble.textContent = `エラー: ${data.error?.message || '応答を生成できませんでした'}`;
      finishSending();
    });
    events.onerror = () => {
      if (!state.sending) return;
      events.close();
      pendingBubble.textContent = 'エラー: ストリーミング接続が切れました。再試行してください。';
      finishSending();
    };
  } catch (error) {
    pendingBubble.textContent = `エラー: ${error.message}`;
    finishSending();
  }
}

function askAdditionalInstruction(id) {
  const instruction = window.prompt('この応答への追加指示', 'もう少し詳しく、雰囲気を保って書いて');
  if (instruction?.trim()) startRun({ targetMessageId: id, instruction: instruction.trim() });
}

async function stopGeneration() {
  if (state.runId) await fetch(`/api/runs/${state.runId}/cancel`, { method: 'POST' });
  finishSending();
}

async function sendMessage(event) {
  event.preventDefault();
  const input = $('message-input');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  input.style.height = 'auto';
  await startRun({ message });
}

function bindEvents() {
  document.querySelectorAll('.cancel-button').forEach((button) => button.addEventListener('click', closeDialog));
  $('new-character').addEventListener('click', () => openCharacterForm());
  $('new-story').addEventListener('click', () => createStory().catch(showConversationError));
  $('edit-character').addEventListener('click', () => state.selectedCharacter && openCharacterForm(state.selectedCharacter));
  $('delete-character').addEventListener('click', () => deleteSelectedCharacter().catch(showConversationError));
  $('delete-story').addEventListener('click', () => deleteStory().catch(showConversationError));
  $('persona-settings').addEventListener('click', openPersona);
  $('story-settings').addEventListener('click', openStorySettings);
  $('memory-settings').addEventListener('click', () => refreshStoryMemory());
  $('add-participant').addEventListener('click', openParticipants);
  $('generate-icon').addEventListener('click', () => generateIcon());
  $('character-form').addEventListener('submit', (event) => saveCharacter(event).catch(showConversationError));
  $('persona-form').addEventListener('submit', (event) => savePersona(event).catch(showConversationError));
  $('story-form').addEventListener('submit', (event) => saveStory(event).catch(showConversationError));
  $('memory-form').addEventListener('submit', (event) => saveMemory(event).catch(showConversationError));
  $('new-memory').addEventListener('click', () => resetMemoryForm());
  $('participant-form').addEventListener('submit', (event) => addParticipant(event).catch(showConversationError));
  $('stop-generation').addEventListener('click', () => stopGeneration().catch(showConversationError));
  $('composer').addEventListener('submit', sendMessage);
  $('retry-conversation').addEventListener('click', () => state.selectedCharacter && chooseCharacter(state.selectedCharacter.id));
  $('message-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('composer').requestSubmit();
    }
  });
  $('message-input').addEventListener('input', (event) => {
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
  });
}

async function init() {
  bindEvents();
  state.userSettings = await api('/settings');
  state.characters = asList(await api('/characters'));
  drawCharacters();
  drawStories();
  const health = await fetch('/api/health').then((response) => response.json()).catch(() => null);
  setText('backend-status', health?.backend?.backend || 'offline');
  const requestedId = new URLSearchParams(location.search).get('character');
  const initialCharacter = findCharacter(requestedId) || state.characters[0];
  if (initialCharacter) await chooseCharacter(initialCharacter.id);
}

init().catch((error) => {
  setText('empty-state-title', '画面を読み込めませんでした');
  setText('empty-state-description', error.message);
  $('retry-conversation').hidden = false;
});
