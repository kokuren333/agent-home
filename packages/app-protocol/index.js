/** @typedef {'run'|'stream'|'cancel'|'storage'|'resources'} Capability */
/** @typedef {'queued'|'running'|'completed'|'failed'|'cancelled'} RunStatus */
/** @typedef {Object} AgentSettings
 * @property {string} model
 * @property {''|'low'|'medium'|'high'|'xhigh'|'max'|'ultra'} reasoningEffort
 * @property {number} updatedAt
 */

/**
 * The intentionally small runtime contract shared by the gateway and every app.
 * Apps are discovered from a manifest and a runtime module; the gateway never
 * needs to understand an app's input or resource schema.
 *
 * @typedef {Object} App
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} version
 * @property {string} icon
 * @property {string} entry
 * @property {Capability[]} capabilities
 */

/** @typedef {Object} Run
 * @property {string} id
 * @property {string} appId
 * @property {RunStatus} status
 * @property {unknown} input
 * @property {number} createdAt
 * @property {number|null} startedAt
 * @property {number|null} finishedAt
 * @property {string|null} error
 */

/** @typedef {Object} Event
 * @property {string} id
 * @property {string} runId
 * @property {'run.started'|'message.delta'|'message.completed'|'run.completed'|'run.failed'|'run.cancelled'|'artifact.created'} type
 * @property {unknown} data
 * @property {number} createdAt
 */

/** @typedef {Object} Artifact
 * @property {string} id
 * @property {string} runId
 * @property {string} kind
 * @property {string} name
 * @property {string} uri
 * @property {number} createdAt
 */

/** @typedef {Object} ProtocolError
 * @property {string} code
 * @property {string} message
 * @property {unknown} [details]
 */

export const PROTOCOL_VERSION = '0.1';

export function errorPayload(code, message, details) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function isValidManifest(manifest) {
  return Boolean(manifest && typeof manifest.id === 'string' && typeof manifest.name === 'string'
    && typeof manifest.description === 'string' && typeof manifest.version === 'string'
    && typeof manifest.icon === 'string' && typeof manifest.entry === 'string'
    && Array.isArray(manifest.capabilities));
}
