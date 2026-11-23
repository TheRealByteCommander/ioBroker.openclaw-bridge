'use strict';

/**
 * Structured bridge error. Every failure that reaches the agent carries a
 * stable `code`, a human readable `message` and a machine readable `nextAction`.
 */
class BridgeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ details?: unknown, hint?: unknown }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    if (extra.details !== undefined) this.details = extra.details;
    if (extra.hint !== undefined) this.hint = extra.hint;
  }
}

const NEXT_ACTIONS = {
  EACTIONFORBIDDEN: 'use_allowed_action_or_update_config',
  EIDFORBIDDEN: 'use_allowed_prefix_or_update_config',
  EIDUNKNOWN: 'call_listStates_and_use_an_existing_id',
  EREADONLY: 'choose_a_writable_state',
  ECONFIRMREQUIRED: 'resend_with_confirmation_true',
  ECONFIRMPENDING: 'wait_for_human_confirmation_then_check_getPendingConfirmations',
  ETIMEOUT: 'check_adapter_latency_or_raise_timeout',
  EBADREQUEST: 'fix_request_payload',
  EBADJSON: 'fix_request_payload',
  EQUEUEFULL: 'retry_later',
  EUNAUTHORIZED: 'send_valid_token',
  EHABITNOTFOUND: 'record_more_observations_or_use_known_habit_name',
  EMODEFORBIDDEN: 'use_observe_suggest_or_autonomous',
  ENOTREADY: 'keep_observing_until_learning_status_ready',
  EGUARDFAILED: 'satisfy_and_or_xor_conditions_or_include_them_in_the_same_plan',
  ETHRESHOLD: 'wait_until_threshold_is_met_or_lower_threshold_value',
  EDURATIONLIMIT: 'turn_off_target_or_raise_max_on_minutes',
  ECOOLDOWN: 'wait_for_min_off_minutes',
  EBATCHLIMIT: 'split_batch_into_smaller_requests',
  EAUDIOPATH: 'place_audio_in_configured_sttAudioDir',
};

function nextActionFor(code) {
  return NEXT_ACTIONS[code] || 'retry';
}

function toStructuredError(err, fallbackCode = 'EUNKNOWN') {
  const code = err?.code || fallbackCode;
  return {
    code,
    message: err?.message || String(err),
    details: err?.details,
    nextAction: nextActionFor(code),
    hint: err?.hint,
  };
}

module.exports = {
  BridgeError,
  NEXT_ACTIONS,
  nextActionFor,
  toStructuredError,
};
