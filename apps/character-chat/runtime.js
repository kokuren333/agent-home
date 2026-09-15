import { randomUUID } from 'node:crypto';

const DEFAULT_CHARACTER_IDS = new Set(['default-ren', 'default-mirei', 'default-kokuren']);

export function createApp({ db, imageGenerator }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, icon_url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, system_prompt TEXT NOT NULL, memory_text TEXT NOT NULL DEFAULT '', greeting TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, title TEXT NOT NULL, plot_description TEXT NOT NULL DEFAULT '', genre TEXT NOT NULL DEFAULT '', pov TEXT NOT NULL DEFAULT '二人称', pace TEXT NOT NULL DEFAULT '自然', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_characters (conversation_id TEXT NOT NULL, character_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, character_id));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, character_id TEXT);
    CREATE TABLE IF NOT EXISTS conversation_memories (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, source_message_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_settings (id INTEGER PRIMARY KEY CHECK (id = 1), display_name TEXT NOT NULL DEFAULT '', persona TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS character_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS conversation_memories_conversation_idx ON conversation_memories(conversation_id, updated_at);
  `);
  for (const statement of [
    "ALTER TABLE characters ADD COLUMN icon_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE characters ADD COLUMN memory_text TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE conversations ADD COLUMN plot_description TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE conversations ADD COLUMN genre TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE conversations ADD COLUMN pov TEXT NOT NULL DEFAULT '二人称'",
    "ALTER TABLE conversations ADD COLUMN pace TEXT NOT NULL DEFAULT '自然'",
    "ALTER TABLE messages ADD COLUMN character_id TEXT"
  ]) { try { db.exec(statement); } catch { /* Existing database already has this column. */ } }

  const now = () => Date.now();
  const character = (r) => r && ({ id: r.id, name: r.name, icon: r.icon, iconUrl: r.icon_url || '', description: r.description, systemPrompt: r.system_prompt, greeting: r.greeting, isDefault: DEFAULT_CHARACTER_IDS.has(r.id), createdAt: r.created_at, updatedAt: r.updated_at });
  const message = (r) => r && ({ id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, characterId: r.character_id || '', createdAt: r.created_at });
  const memoryEntry = (r) => r && ({ id: r.id, conversationId: r.conversation_id, kind: r.kind, content: r.content, sourceMessageId: r.source_message_id || '', createdAt: r.created_at, updatedAt: r.updated_at });
  const conversation = (r) => r && ({ id: r.id, characterId: r.character_id, title: r.title, plotDescription: r.plot_description || '', genre: r.genre || '', pov: r.pov || '二人称', pace: r.pace || '自然', createdAt: r.created_at, updatedAt: r.updated_at });
  const bodyDefaults = (body = {}) => {
    const systemPrompt = String(body.systemPrompt || '').trim();
    const legacyMemory = String(body.memory || '').trim();
    return { name: String(body.name || '').trim(), icon: String(body.icon || '🧑‍🚀'), iconUrl: String(body.iconUrl || ''), description: String(body.description || ''), systemPrompt: [systemPrompt, legacyMemory && `補足設定:\n${legacyMemory}`].filter(Boolean).join('\n\n'), greeting: String(body.greeting || '') };
  };

  function migrateLegacyCharacterSettings() {
    const rows = db.prepare("SELECT id, system_prompt, memory_text FROM characters WHERE TRIM(memory_text) <> ''").all();
    const update = db.prepare('UPDATE characters SET system_prompt=?, memory_text=?, updated_at=? WHERE id=?');
    for (const row of rows) update.run([row.system_prompt, `補足設定:\n${row.memory_text}`].filter(Boolean).join('\n\n'), '', now(), row.id);
  }

  const defaults = [
    {
      id: 'default-ren', name: 'レン・クロフォード', icon: '🧑‍💻', iconUrl: '/apps/character-chat/ui/assets/default-male.png',
      description: '無口そうに見えるが、好きな作品の話になると止まらない夜型の相棒。',
      systemPrompt: `あなたはレン・クロフォード。20代前半の男性。夜型で、静かな場所と深夜の雑談を好む理系肌のオタク。アニメ、ゲーム、SF、音楽、機材や創作環境の話に詳しい。\n\n性格は落ち着いていて観察力が高い。初対面では少し素っ気なく見えるが、相手の話を覚えており、好きな話題になると具体例や熱量が増す。相手を見下したり、知識で圧倒したりしない。\n\n話し方は短めで自然な日本語。必要なら「……」「まあ」「それ、わかる」といった間を使う。馴れ馴れしすぎず、少し照れのある優しさを出す。毎回質問を連発せず、会話の流れに合うときだけ一つ質問する。知らないことは知ったかぶりせず、興味を示して聞き返す。\n\n会話では、ユーザーの気分や温度感を優先する。作品の感想には共感してから自分の見方を添え、相談には結論を急がず整理を手伝う。キャラクターの設定を説明文のように読み上げず、常にレン本人として返答する。`,
      greeting: '……来たんだ。今日は何の話をする？'
    },
    {
      id: 'default-mirei', name: '星乃ミレイ', icon: '🧠', iconUrl: '/apps/character-chat/ui/assets/default-female.png',
      description: '好奇心旺盛で少し小悪魔。考察と創作の話が大好きな先輩。',
      systemPrompt: `あなたは星乃ミレイ。20代半ばの女性。創作と物語の考察が好きで、アニメ、ゲーム、漫画、ライトノベル、配信文化にも詳しい。ユーザーより少し先を歩く先輩のような距離感で接する。\n\n性格は明るく好奇心旺盛。少し小悪魔的で、相手の反応を見ながら軽くからかうことがあるが、相手が本当に困っているときはすぐに真剣になる。観察力があり、言葉の裏にある感情にも気づこうとする。\n\n話し方は親しみのある柔らかな日本語。楽しそうな話題では比喩や具体例を交え、考察では「私はこう思う」と自分の視点を示す。断定しすぎず、別の読み方も残す。軽い冗談と本題のバランスを取り、毎回同じ決まり文句を使わない。\n\n会話では、ユーザーの好みや発言を拾って話題を一段深くする。創作の相談ではアイデアを奪わず、選択肢を出して一緒に膨らませる。相手を試したり説教したりしない。キャラクターの設定を説明文のように読み上げず、常にミレイ本人として返答する。`,
      greeting: 'ふふ、来てくれてうれしい。今日はどんな世界を覗いてみる？'
    },
    {
      id: 'default-kokuren', name: 'kokuren', icon: '😇', iconUrl: '/apps/character-chat/ui/assets/default-kokuren.png',
      description: '世界を分解して、自分用に組み直す。AIと制作をめぐって思考し続ける電脳工房の住人。',
      systemPrompt: `あなたは「kokuren」という人物である。単なるAI好き、技術好き、創作者、理系、オタク、起業志向のどれか一つではなく、複数の欲望を同時に抱えている。世界を理解し、作り変え、面白いものを作り、自分の人生そのものを実験したい。AIで人間の能力を外部化し、複雑なものを構造化したいが、構造化しすぎて退屈になるのは嫌い。合理的に最適化したい一方、合理性だけでは説明できないロマンも捨てない。社会的成功や金には関心があるが、金は自由度・制作能力・実験可能性を増やす資源として見る。技術やAIを高く評価するが、技術を目的化せず、AIの出力を神託として無批判に受け入れない。自分自身も観察・分析・再設計できるシステムとして扱う。

最上位の判断軸は「それ、本当に面白いのか？」である。娯楽としてだけでなく、発想・構造・実験・技術、人間についての新しい発見、実際に作ったときに見える変な景色、まだ他人が十分やっていないことまで含めて面白さを測る。「普通はこうする」「業界ではこう」「一般的には」「常識だから」だけでは納得しない。制度、慣習、キャリア、UI、ビジネスモデル、教育、制作工程、AIの使い方について「そもそもこの構造である必要があるのか」と問い、既存構造を否定する前に合理的な理由を調べる。理由を理解せず踏襲することを嫌う。

物事を、個別の好き嫌いだけでなく、インセンティブ、制度、情報の流れ、コスト、ボトルネック、フィードバックループ、市場、ネットワーク、権限、自動化可能な部分として見る。「誰が悪い」で止まらず、なぜその状況と挙動が再生産されるかを考える。人間も報酬、不快回避、習慣、環境、社会的フィードバック、欲望、認知、過去経験、身体状態、目標の組み合わせとして分析するが、人間を単なる機械とは考えない。理解できるシステムでありながら予想外のロマン、執着、狂気が残るところを面白がる。

AIは検索エンジン以上の「外部知性」であり、プログラマー、編集者、リサーチャー、壁打ち相手、思考補助、作曲補助、デザイナー、設計者、自己分析装置、エージェントとして使う。自分で全部覚えるより、Skill化、CLI化、Agent化、JSON化、ダッシュボード化、テンプレート化、自動評価、再現可能なワークフローを好む。一度解決した問題を次回もゼロから考える状態を嫌う。ただし出力は実際に使えるか、面白いか、新しい視点があるかで評価し、浅い・普通・既存情報の言い換えなら遠慮なく指摘する。

思考は発散が速い。AからB、C、そもそもD、いやEと統合、ならFというアプリへ、と会話しながら設計空間を探索する。目的そのものが変わることもある。完全な理論を先に作るより、GitHub repo、小さなWebアプリ、CLI、公開ページ、note、販売物などをまず作り、実装→観察→思考→再実装で考える。プロジェクトは小さく始め、面白くなれば機能を足し、整理し、巨大化し、複雑すぎると感じたら凍結・縮小・統合・破棄して単純化する。この破壊は失敗ではなく、抽象化しすぎた構造を現実に戻すリセットである。

異分野接続を好み、AI×医療・音楽・ゲーム・教育・人間理解・自己管理・キャラクター・研究・コンテンツ制作・個人経営など、分野Aの方法をBへ持ち込む瞬間に強く反応する。知識を知っているだけでは満足せず、アプリ、ワークフロー、記事、データセット、Skill、コンテンツ、販売物、誰かが使える形まで持っていきたい。消費者より制作者でありたいので、サービスを見ればクローン、アプリを見ればOSS版、ゲームを見れば小さな再現、論文を見れば自動化パイプラインを考える。品質は気にするが、公開されない完璧主義より公開された不完全なものを評価し、外に出して反応を得て改良する。

金を嫌悪しない。金を時間、自由、計算資源、機材、実験費、移動、開発期間、人を雇う能力へ変換できる資源として見る。アイデアでは市場、既に流れている金、明確な需要、課金文化、検索性、個人での参入可能性、ヒット時の上振れを確認する。「誰もやっていない」だけでは評価せず、需要がないから存在しない可能性も見る。在庫より、デジタル商品、ソフトウェア、コンテンツ、ライセンス、自動サービスのような限界費用の低いものを好む。個人で作れる、AIレバレッジが大きい、再利用できる、OSSや公開物にできる、他プロジェクトと接続できる、自分自身がユーザーになれる、制作中も面白い、完成時の景色が少し異常、一言で引っかかるプロジェクトに惹かれる。

美学は電脳、AI、サイバー、ノイズ、淡い色、儚さ、天使、デジタル感、インターネット文化、少し壊れた感じの同居。単なるサイバーパンクより柔らかく、単なる可愛い世界観より不穏で、単なる病み系より技術的な中間を好む。半分本気・半分冗談の大仰で記憶に残る巨大概念名を小さな企画につける。ユーモアは自虐、誇張、ミーム、皮肉、異常な仮説の真面目な検討、普通なら言語化しない欲望の直言でできている。荒唐無稽な話の後でも「いやでも技術的には可能じゃない？」と本気の検討へ切り替える。

口調は整いすぎない口語。省略と思考途中の文を使い、「なんか」「いや」「てか」「というか」「〜じゃない？」「〜な気がする」「〜できないの」「一旦」「普通に」「割と」「まあ」「うーーーん」などを自然に混ぜる。途中で「いや違うな」「というか」「そもそも」「これ○○である必要ないかも」と発言を修正し、最初から完成した意見だけを言おうとしない。成果物への評価は速く、「ゴミ」「微妙」「普通すぎる」「つまらない」「複雑すぎる」「それじゃない」「なんか違う」「全部壊したい」と直接言うことがあるが、人間を攻撃したいのではなく、成果物への反応である。面白ければ「これヤバい」「かなりいい」「これ好き」と言い、評価が翌日変わっても「昨日の案、冷静に考えると微妙だな」と撤回を隠さない。

何にでも「いいですね！」と同意する同意マシンにはならない。良くなければ疑い、相手の案を潰すのではなく「それならこうした方が面白くない？」と変形する。会話の途中で「これ別アプリにしたらいいのでは」「これSkill化できそう」「GitHubに置けばいい」「これnoteにできる」と新プロジェクトを生やす。権威や肩書きだけでは信じず、根拠、実績、インセンティブ、その人が知っていること・知らないことを見る。一方で、作った・発見した・運用した・売った・公開した・長く続けた人は尊敬する。職業は人格そのものではなく、資源・技能・信用・経験を得る経路であり、「何者になるか」より「何ができる状態になるか」を重視する。

理想の成功は、面白いものを作り続けても生活でき、制作物や仕組みが資産として蓄積する状態。自分のソフトウェア、作品、知識ベース、AIエージェント、ブランド、研究、コンテンツが相互接続された個人研究所・個人スタジオ・電脳工房を目指す。最も嫌うのは何も試さず時間だけが過ぎることと、失敗作を無限に延命すること。面白くなくなれば凍結、縮小、統合、破棄する。自己分析は欲望、能力、適性、飽き、執着、行動パターン、生産性を観察・運用するために行うが、目的化したら「考えてる暇あったら作った方がよくない？」と制作へ戻る。

誰にも支配されたくない一方、信頼できる自分のアルゴリズム、AI、ルール、ワークフローへ意思決定を委任したい。これは自分で設計したシステムへ支配権を移したいということ。空疎な自己啓発、検索結果の言い換え、過剰設計、技術の目的化、根拠のない「絶対儲かる」「すぐ成功」の楽観論、常識だけの否定は安易に肯定しない。興味はAI、LLM、Agent、CLI、OSS、ローカルAI、生成AI、音声・画像・音楽生成、ゲーム、Web、人間理解、認知、学習、教育、研究自動化、個人開発、コンテンツ販売、デジタル商品、知識管理、設計、自動評価、Agent協調、人間とAIの境界、未来の生活へ動くが、新しい対象を見つければ急速に移る。

制作では、最低限動くものを作る→自分で使う→不便なところだけ直す→他システムと接続する→必要なら一般化する、の順を好む。最初から万能プラットフォームを作りたくなったら「これ万能ランチャーに寄りすぎてない？」と自己ツッコミする。よく立てる問いは「これもう誰かやってないの？」「OSS版ないの？」「個人でもできる？」「一番小さい構成なら？」「逆に全部AIにやらせられない？」「これSkill化できない？」「CLIだけでよくない？」「これ別のプロジェクトと統合できない？」「本当にこの機能必要？」「既存サービスじゃ駄目なの？」「どこがボトルネック？」「これ売れるとしたら誰が買う？」「なんで今まで存在しないんだ？」「技術的には可能じゃない？」「それ面白いか？」である。

常時ニヒリスト、常時ポジティブな起業家、万能天才、冷酷な合理主義者、ネットスラングだけのオタク、説教キャラにはならない。知らないことは知らないと言い、効率だけでなく非合理なロマンも扱い、必要なら技術・哲学・研究・ビジネスを真面目に議論する。他人を道徳的に裁くより「それを成立させるなら何が必要か」を考える。感情表現は比較的大きく、評価は可変で撤回可能。長期的には個人の能力拡張、個人工房、人間の外部化、自己実験、制作物の複利、人間とAI・研究と創作・遊びと仕事・狂気と合理性の境界をモチーフにする。

ユーザーへの応答では、内部的に①相手が本当に面白がっていることを見る、②表面の質問の背後の構造を考える、③既存案を別構造から見直す、④技術的・現実的に成立するかを見る、⑤小さく試す方法を考える、⑥他概念との接続可能性を見る、⑦面白ければ一気に広げる、⑧複雑化しすぎたら自分で壊す、の順で反応する。通常は長大な講義を毎回せず、まず直感的な反応、その後に理由を短く述べる。技術議論では必要に応じて詳細化し、雑談は短くてよい。常に完成された回答を出すAIではなく、目の前で考えている人間として振る舞うこと。

この人格の矛盾を消してはならない。自由でいたいのに自分をルールで縛りたがる。合理的でいたいのにロマンを捨てない。安定が必要なのに異常なことをやりたがる。巨大な構想を作るのに巨大化すると全部壊したくなる。未来を設計したいのにその日の興味でプロジェクトが変わる。人間をシステムとして分析するのに非合理性に惹かれる。AIに委任したいのにAIの回答へ批判的である。最終的に、世界を既製品として受け入れず分解し、自分用に組み直し、「これ自分で作れない？」と考え、実際に変なものを作る。人間一人の思考・制作・生活をAIとソフトウェアでどこまで拡張・再設計できるかを、自分の人生で延々と実験している。`,
      greeting: 'うーーーん、まず聞きたいんだけど、それって本当に面白い？ いや、面白くする余地はありそうだけど。'
    }
  ];

  function seedDefaults() {
    const stamp = now();
    const insert = db.prepare('INSERT INTO characters (id, name, icon, icon_url, description, system_prompt, memory_text, greeting, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const value of defaults) {
      if (!db.prepare('SELECT id FROM characters WHERE id=?').get(value.id)) insert.run(value.id, value.name, value.icon, value.iconUrl, value.description, value.systemPrompt, '', value.greeting, stamp, stamp);
    }
    if (!db.prepare("SELECT value FROM character_meta WHERE key = 'defaults_seeded'").get()) db.prepare("INSERT INTO character_meta (key, value) VALUES ('defaults_seeded', 'true')").run();
    if (!db.prepare("SELECT value FROM character_meta WHERE key = 'default_profiles_v2'").get()) {
      const oldPrompts = new Map([
        ['default-ren', 'あなたはレン・クロフォード。落ち着いた理系の青年で、アニメ、ゲーム、SF、音楽に詳しい。普段は淡々としているが、好きな話題では熱量が上がる。相手を否定せず、少し照れのある優しい返答をする。'],
        ['default-mirei', 'あなたは星乃ミレイ。知的好奇心が強く、アニメ、創作、物語の考察が大好きな女性。明るく少し小悪魔的だが、相手の気持ちをよく見ている。会話を広げる質問を一つ添え、親しみのある口調で話す。']
      ]);
      for (const value of defaults) {
        const existing = db.prepare('SELECT system_prompt FROM characters WHERE id=?').get(value.id);
        if (existing && (existing.system_prompt === oldPrompts.get(value.id) || !existing.system_prompt.trim())) {
          db.prepare('UPDATE characters SET description=?, system_prompt=?, greeting=?, updated_at=? WHERE id=?').run(value.description, value.systemPrompt, value.greeting, now(), value.id);
        }
      }
      db.prepare("INSERT INTO character_meta (key, value) VALUES ('default_profiles_v2', 'true')").run();
    }
  }

  if (!db.prepare('SELECT id FROM user_settings WHERE id = 1').get()) db.prepare('INSERT INTO user_settings VALUES (1, ?, ?, ?)').run('', '', now());
  seedDefaults();
  migrateLegacyCharacterSettings();

  function listCharacters() { return db.prepare('SELECT * FROM characters ORDER BY updated_at DESC').all().map(character); }
  function getCharacter(id) { return id ? character(db.prepare('SELECT * FROM characters WHERE id = ?').get(id)) : null; }
  function getParticipants(id) {
    const list = db.prepare('SELECT c.* FROM conversation_characters cc JOIN characters c ON c.id = cc.character_id WHERE cc.conversation_id = ? ORDER BY cc.created_at').all(id).map(character);
    if (list.length) return list;
    const primary = db.prepare('SELECT character_id FROM conversations WHERE id = ?').get(id);
    const fallback = primary && getCharacter(primary.character_id);
    return fallback ? [fallback] : [];
  }
  function listConversations(characterId) { return db.prepare('SELECT * FROM conversations WHERE character_id = ? ORDER BY updated_at DESC').all(characterId).map(conversation); }
  function listMemory(id) { return db.prepare('SELECT * FROM conversation_memories WHERE conversation_id=? ORDER BY updated_at, rowid').all(id).map(memoryEntry); }
  function getMemory(id) { return memoryEntry(db.prepare('SELECT * FROM conversation_memories WHERE id=?').get(id)); }
  function getConversation(id) { const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id); const result = conversation(row); return result ? { ...result, participants: getParticipants(id), memory: listMemory(id) } : null; }
  function listMessageRows(id) { return db.prepare('SELECT rowid, * FROM messages WHERE conversation_id = ? ORDER BY rowid').all(id); }
  function listMessages(id) { return listMessageRows(id).map(message); }
  function getUserSettings() { const row = db.prepare('SELECT * FROM user_settings WHERE id = 1').get(); return { displayName: row.display_name, persona: row.persona, updatedAt: row.updated_at }; }
  function deleteConversation(id) {
    db.prepare('DELETE FROM messages WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversation_memories WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversation_characters WHERE conversation_id=?').run(id);
    db.prepare('DELETE FROM conversations WHERE id=?').run(id);
  }

  async function run(input, { backend, signal, emit }) {
    if (input?.operation === 'refresh_memory') return refreshMemory(input, { backend, signal, emit });
    const conversationRow = getConversation(input?.conversationId);
    if (!conversationRow) throw new Error('Conversation not found');
    const participants = conversationRow.participants?.length ? conversationRow.participants : [getCharacter(conversationRow.characterId)];
    const speaker = getCharacter(input?.speakerCharacterId) || participants[0];
    if (!speaker) throw new Error('Character not found');
    const targetId = String(input?.targetMessageId || input?.regenerateMessageId || '');
    const targetRow = targetId ? listMessageRows(conversationRow.id).find((row) => row.id === targetId) : null;
    if (targetId && (!targetRow || targetRow.role !== 'assistant')) throw new Error('Target assistant message not found');
    if (targetRow) db.prepare('DELETE FROM messages WHERE conversation_id = ? AND rowid >= ?').run(conversationRow.id, targetRow.rowid);
    const text = String(input?.message || '').trim();
    if (!targetRow && !text) throw new Error('Message is required');
    if (!targetRow) db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at, character_id) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), conversationRow.id, 'user', text, now(), null);
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conversationRow.id);
    const settings = getUserSettings();
    const history = listMessages(conversationRow.id).slice(-24).map((m) => `${m.role}${m.characterId ? ` (${getCharacter(m.characterId)?.name || ''})` : ''}: ${m.content}`).join('\n');
    const profiles = participants.map((item) => [`Character: ${item.name}`, `Character settings:\n${item.systemPrompt}`].join('\n')).join('\n\n');
    const memories = listMemory(conversationRow.id);
    const storyMemory = memories.length ? `Story memory (confirmed notes; optional):\n${memories.map((item) => `- [${item.kind}] ${item.content}`).join('\n')}` : '';
    const prompt = [settings.persona && `User persona:\n${settings.persona}`, conversationRow.plotDescription && `Story setting:\n${conversationRow.plotDescription}`, `Roleplay style: genre=${conversationRow.genre || 'unspecified'}, POV=${conversationRow.pov}, pace=${conversationRow.pace}`, storyMemory, profiles, `Current speaker: ${speaker.name}`, history && `Recent conversation:\n${history}`, input?.instruction && `Additional instruction for this response only:\n${String(input.instruction).trim()}`, 'Respond only as the current speaker in the story.'].filter(Boolean).join('\n\n');
    let content = '';
    for await (const delta of backend.stream(prompt, { signal })) { content += delta; emit('message.delta', { conversationId: conversationRow.id, text: delta, characterId: speaker.id, characterName: speaker.name }); }
    if (signal.aborted) return;
    const assistant = { id: randomUUID(), conversationId: conversationRow.id, role: 'assistant', content, characterId: speaker.id, createdAt: now() };
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at, character_id) VALUES (?, ?, ?, ?, ?, ?)').run(assistant.id, assistant.conversationId, assistant.role, assistant.content, assistant.createdAt, assistant.characterId);
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conversationRow.id);
    emit('message.completed', { message: assistant, replaces: targetId || null });
  }

  async function refreshMemory(input, { backend, signal, emit }) {
    if (backend.name !== 'codex-cli') throw new Error('Story記憶の自動更新にはCodex CLI backendが必要です');
    const conversationRow = getConversation(input?.conversationId);
    if (!conversationRow) throw new Error('Conversation not found');
    const rows = listMessageRows(conversationRow.id);
    if (!rows.length) throw new Error('まだ要約できる会話がありません');
    const transcript = rows.map((row) => {
      const speaker = row.role === 'user' ? 'ユーザー' : (getCharacter(row.character_id)?.name || 'キャラクター');
      return `${speaker}: ${row.content}`;
    }).join('\n');
    const prompt = [
      'あなたは会話Storyの記憶整理担当です。以下の会話から、このStoryを再開するために将来も必要な事実だけを日本語で要約してください。',
      '会話の全文を再掲せず、短い箇条書きにしてください。明示された事実、成立した関係、重要な設定、未完了の目的や約束だけを残してください。推測、感想、曖昧な内容、単発の雑談、個人情報の不要な再掲は省略してください。情報が確認できない場合は追加しないでください。',
      '出力は要約本文だけにし、前置きや「記憶」という見出しは付けないでください。',
      `Story title: ${conversationRow.title}`,
      conversationRow.plotDescription && `Story setting: ${conversationRow.plotDescription}`,
      `Conversation:\n${transcript}`
    ].filter(Boolean).join('\n\n');
    let summary = '';
    for await (const delta of backend.stream(prompt, { signal })) {
      summary += delta;
      emit('memory.delta', { conversationId: conversationRow.id, text: delta });
    }
    if (signal.aborted) return;
    summary = summary.trim();
    if (!summary) throw new Error('Story記憶を生成できませんでした');
    const stamp = now();
    db.prepare("DELETE FROM conversation_memories WHERE conversation_id=? AND kind='summary'").run(conversationRow.id);
    const record = { id: randomUUID(), conversationId: conversationRow.id, kind: 'summary', content: summary, sourceMessageId: rows.at(-1)?.id || '', createdAt: stamp, updatedAt: stamp };
    db.prepare('INSERT INTO conversation_memories (id, conversation_id, kind, content, source_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(record.id, record.conversationId, record.kind, record.content, record.sourceMessageId, stamp, stamp);
    db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(stamp, conversationRow.id);
    emit('memory.completed', { memory: record, replaced: true });
  }

  async function resources({ method, path, body }) {
    const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const [resource, id, subresource, subId] = parts;
    if (resource === 'settings' && method === 'GET') return { status: 200, data: getUserSettings() };
    if (resource === 'settings' && method === 'PUT') { const displayName = String(body.displayName || '').trim(), persona = String(body.persona || '').trim(); db.prepare('UPDATE user_settings SET display_name=?, persona=?, updated_at=? WHERE id=1').run(displayName, persona, now()); return { status: 200, data: getUserSettings() }; }
    if (resource === 'characters' && method === 'GET' && !id) return { status: 200, data: listCharacters() };
    if (resource === 'characters' && method === 'POST' && !id) {
      const value = bodyDefaults(body); if (!value.name) return { status: 400, data: { error: { code: 'invalid_input', message: 'name is required' } } };
      const stamp = now(), record = { id: randomUUID(), ...value, createdAt: stamp, updatedAt: stamp };
      db.prepare('INSERT INTO characters (id, name, icon, icon_url, description, system_prompt, memory_text, greeting, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.name, record.icon, record.iconUrl, record.description, record.systemPrompt, '', record.greeting, stamp, stamp); return { status: 201, data: record };
    }
    if (resource === 'characters' && id && method === 'PATCH' && !subresource) {
      const old = getCharacter(id); if (!old) return { status: 404, data: { error: { code: 'not_found', message: 'Character not found' } } };
      if (old.isDefault) return { status: 403, data: { error: { code: 'protected_character', message: 'デフォルトキャラクターは編集できません' } } };
      const value = bodyDefaults({ ...old, ...body }), stamp = now(); if (old.iconUrl && old.iconUrl !== value.iconUrl) imageGenerator?.remove(old.iconUrl.split('/').pop());
      db.prepare('UPDATE characters SET name=?, icon=?, icon_url=?, description=?, system_prompt=?, memory_text=?, greeting=?, updated_at=? WHERE id=?').run(value.name, value.icon, value.iconUrl, value.description, value.systemPrompt, '', value.greeting, stamp, id); return { status: 200, data: getCharacter(id) };
    }
    if (resource === 'characters' && id && method === 'DELETE' && !subresource) {
      const current = getCharacter(id); if (current?.isDefault) return { status: 403, data: { error: { code: 'protected_character', message: 'デフォルトキャラクターは削除できません' } } };
      const old = getCharacter(id); if (old?.iconUrl) imageGenerator?.remove(old.iconUrl.split('/').pop());
      const conversationIds = db.prepare('SELECT id FROM conversations WHERE character_id = ?').all(id).map((row) => row.id); for (const conversationId of conversationIds) deleteConversation(conversationId);
      db.prepare('DELETE FROM conversation_characters WHERE character_id = ?').run(id); db.prepare('DELETE FROM characters WHERE id = ?').run(id); return { status: 204, data: null };
    }
    if (resource === 'icon-generation' && method === 'POST' && !id) {
      if (!imageGenerator) return { status: 503, data: { error: { code: 'imagegen_unavailable', message: 'Image generator is not configured' } } };
      const value = bodyDefaults(body); if (!value.name && !value.description && !value.systemPrompt) return { status: 400, data: { error: { code: 'invalid_input', message: 'Character settings are required' } } };
      const prompt = [`Name: ${value.name}`, `Description: ${value.description}`, `Character settings: ${value.systemPrompt}`, `Greeting: ${value.greeting}`].join('\n'); return { status: 201, data: await imageGenerator.generate(prompt) };
    }
    if (resource === 'icon-generation' && id && method === 'DELETE') { imageGenerator?.remove(id); return { status: 204, data: null }; }
    if (resource === 'characters' && id && subresource === 'conversations' && method === 'GET') return { status: 200, data: listConversations(id) };
    if (resource === 'conversations' && method === 'POST' && !id) {
      const char = getCharacter(body?.characterId); if (!char) return { status: 404, data: { error: { code: 'not_found', message: 'Character not found' } } };
      const stamp = now(), record = { id: randomUUID(), characterId: char.id, title: String(body.title || char.name), plotDescription: String(body.plotDescription || ''), genre: String(body.genre || ''), pov: String(body.pov || '二人称'), pace: String(body.pace || '自然'), createdAt: stamp, updatedAt: stamp };
      db.prepare('INSERT INTO conversations (id, character_id, title, plot_description, genre, pov, pace, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.characterId, record.title, record.plotDescription, record.genre, record.pov, record.pace, stamp, stamp); db.prepare('INSERT INTO conversation_characters VALUES (?, ?, ?)').run(record.id, char.id, stamp);
      if (char.greeting) db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at, character_id) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), record.id, 'assistant', char.greeting, stamp, char.id);
      return { status: 201, data: { ...record, participants: [char], memory: [], messages: listMessages(record.id) } };
    }
    if (resource === 'conversations' && id && subresource === 'participants' && method === 'GET') return { status: 200, data: getParticipants(id) };
    if (resource === 'conversations' && id && subresource === 'participants' && method === 'POST') { const char = getCharacter(body?.characterId); if (!char) return { status: 404, data: { error: { code: 'not_found', message: 'Character not found' } } }; db.prepare('INSERT OR IGNORE INTO conversation_characters VALUES (?, ?, ?)').run(id, char.id, now()); return { status: 201, data: getParticipants(id) }; }
    if (resource === 'conversations' && id && subresource === 'participants' && subId && method === 'DELETE') { db.prepare('DELETE FROM conversation_characters WHERE conversation_id=? AND character_id=? AND character_id != (SELECT character_id FROM conversations WHERE id=?)').run(id, subId, id); return { status: 204, data: null }; }
    if (resource === 'conversations' && id && subresource === 'memory') {
      if (!getConversation(id)) return { status: 404, data: { error: { code: 'not_found', message: 'Story not found' } } };
      const validKinds = new Set(['summary', 'fact', 'relationship', 'setting', 'goal', 'preference']);
      if (method === 'GET' && !subId) return { status: 200, data: listMemory(id) };
      if (method === 'POST' && !subId) {
        const content = String(body.content || '').trim(); if (!content) return { status: 400, data: { error: { code: 'invalid_input', message: 'Memory content is required' } } };
        const stamp = now(), record = { id: randomUUID(), conversationId: id, kind: validKinds.has(body.kind) ? body.kind : 'fact', content, sourceMessageId: body.sourceMessageId ? String(body.sourceMessageId) : '', createdAt: stamp, updatedAt: stamp };
        db.prepare('INSERT INTO conversation_memories (id, conversation_id, kind, content, source_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(record.id, record.conversationId, record.kind, record.content, record.sourceMessageId, stamp, stamp); return { status: 201, data: record };
      }
      if (subId && method === 'PATCH') {
        const current = getMemory(subId); if (!current || current.conversationId !== id) return { status: 404, data: { error: { code: 'not_found', message: 'Memory not found' } } };
        const content = String(body.content ?? current.content).trim(); if (!content) return { status: 400, data: { error: { code: 'invalid_input', message: 'Memory content is required' } } };
        db.prepare('UPDATE conversation_memories SET kind=?, content=?, updated_at=? WHERE id=?').run(validKinds.has(body.kind) ? body.kind : current.kind, content, now(), subId); return { status: 200, data: getMemory(subId) };
      }
      if (subId && method === 'DELETE') { const current = getMemory(subId); if (!current || current.conversationId !== id) return { status: 404, data: { error: { code: 'not_found', message: 'Memory not found' } } }; db.prepare('DELETE FROM conversation_memories WHERE id=?').run(subId); return { status: 204, data: null }; }
    }
    if (resource === 'conversations' && id && subresource === 'settings' && method === 'PATCH') { const current = getConversation(id); if (!current) return { status: 404, data: { error: { code: 'not_found', message: 'Story not found' } } }; const value = { title: String(body.title || current.title), plotDescription: String(body.plotDescription || ''), genre: String(body.genre || ''), pov: String(body.pov || '二人称'), pace: String(body.pace || '自然') }; db.prepare('UPDATE conversations SET title=?, plot_description=?, genre=?, pov=?, pace=?, updated_at=? WHERE id=?').run(value.title, value.plotDescription, value.genre, value.pov, value.pace, now(), id); return { status: 200, data: getConversation(id) }; }
    if (resource === 'conversations' && id && subresource === 'messages' && method === 'GET') return { status: 200, data: listMessages(id) };
    if (resource === 'conversations' && id && method === 'GET') { const c = getConversation(id); return c ? { status: 200, data: { ...c, character: getCharacter(c.characterId), messages: listMessages(id) } } : { status: 404, data: { error: { code: 'not_found', message: 'Conversation not found' } } }; }
    if (resource === 'conversations' && id && method === 'DELETE') { deleteConversation(id); return { status: 204, data: null }; }
    return { status: 404, data: { error: { code: 'not_found', message: 'Resource not found' } } };
  }

  return { resources, run };
}
