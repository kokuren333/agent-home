import path from "node:path";

export function setTestEnv(root: string): void {
  Object.assign(process.env, {
    DISCORD_TOKEN: "test-token",
    DISCORD_CLIENT_ID: "test-client",
    DISCORD_GUILD_IDS: "test-guild",
    DISCORD_ADMIN_USER_IDS: "test-admin",
    EBE_VAULT_ROOT: root,
    EBE_WORKTREE_ROOT: path.join(root, "worktrees"),
    EBE_BOT_DATA_DIR: path.join(root, "data"),
    EBE_BOT_LOG_DIR: path.join(root, "logs"),
    EBE_RESOURCE_GUARD_ENABLED: "false",
    EBE_MAX_WORKERS: "2",
    EBE_KEEP_FAILED_WORKTREES: "true",
    EBE_KEEP_SUCCESSFUL_WORKTREES: "false",
    EBE_DAILY_NEWS_ENABLED: "false",
    GIT_REMOTE: "origin",
    GIT_BRANCH: "main",
    GIT_COMMIT_MESSAGE: "test update",
    GIT_BOT_USER_NAME: "ebs-test",
    GIT_BOT_USER_EMAIL: "ebs-test@example.invalid",
  });
}
