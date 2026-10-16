// Generated from independent optional voice JSON schemas by scripts/check-voice-contracts.mjs.
// Do not edit; run bun scripts/check-voice-contracts.mjs --write after contract generation.

export type ApprovalInteractionMode = "voice_allowed" | "explicit_click";

export type ApprovalTarget = {
  "action_id": string;
  "attempt_id": string;
  "execution_id": string;
  "expected_attempt_version": number;
  "expected_execution_version": number;
  "expected_step_version": number;
  "interaction_agent_session_id": string;
  "interaction_binding_version": number;
  "interaction_mode": ApprovalInteractionMode;
  "presentation_digest": string;
  "presentation_id": string;
  "question_digest": string;
  "request_event_sequence": number;
  "step_id": string;
  "work_target": WorkTarget;
};

export type AudioEncoding = "pcm" | "opus" | "wav" | "mp3" | "aac" | "flac" | "g711_mu_law" | "g711_a_law";

export type AudioFormat = {
  "channels": number;
  "encoding": AudioEncoding;
  "sample_format": AudioSampleFormat;
  "sample_rate": number;
};

export type AudioFrame = {
  "activation_epoch": number;
  "duration_us": number;
  "format": AudioFormat;
  "output_generation": number;
  "payload": Array<number>;
  "sequence": number;
  "timestamp": number;
};

export type AudioSampleFormat = "signed16_le" | "float32_le" | "encoded";

export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type DeliveryState = "generated" | "queued" | "played" | "interrupted" | "revoked";

export type MediaRange = {
  "end_us": number;
  "start_us": number;
};

export type MediaSpec = {
  "format": AudioFormat;
  "max_buffer_duration_us": number;
  "max_frame_age_us": number;
  "max_frame_bytes": number;
  "max_frame_duration_us": number;
  "min_frame_duration_us": number;
  "timebase": number;
};

export type OutputSegment = {
  "correlation_id"?: string | null;
  "output_generation": number;
  "response_id": string;
  "revision": number;
  "segment_id": string;
  "text"?: string | null;
};

export type PlaybackPrecision = "exact" | "estimated" | "unknown";

export type PlaybackReceipt = {
  "activation_epoch": number;
  "consumed_us": number;
  "output_generation": number;
  "precision": PlaybackPrecision;
  "revision": number;
  "segment_id": string;
  "state": DeliveryState;
  "uncertain_tail_us": number;
};

export type TranscriptCommit = "tentative" | "committed";

export type TranscriptFragment = {
  "commit": TranscriptCommit;
  "fragment_id": string;
  "media_range"?: MediaRange | null;
  "revision": number;
  "speaker": VoiceSpeaker;
  "text": string;
};

export type VerifiedVoiceFact = {
  "canonical_receipt_id": string;
  "content": string;
  "correlation_id": string;
  "output_generation"?: number | null;
  "speak": boolean;
  "speech_source"?: VoiceSpeechSourceRef | null;
  "upstream_trigger_id"?: string | null;
  "work_context"?: VoiceWorkContextFact | null;
};

export type VoiceActivationRequest = {
  "agent_session_id": string;
  "binding_version": number;
  "endpoint_id": string;
  "native_offer"?: string | null;
  "profile_id": string;
  "profile_revision": number;
  "takeover"?: boolean;
  "transport": VoiceTransportPreference;
};

export type VoiceActivationResponse = {
  "activation_epoch": number;
  "attachment_token": string;
  "negotiation": VoiceNegotiation;
  "state": VoiceState;
  "voice_session_id": string;
};

export type VoiceAdapterDescriptor = {
  "adapter_id": string;
  "api_version": string;
  "capabilities": {
  "continuous_input"?: VoiceCapabilityEvidence;
  "controlled_output_boundary"?: VoiceCapabilityEvidence;
  "delegation"?: VoiceCapabilityEvidence;
  "exact_output_truncation"?: VoiceCapabilityEvidence;
  "fact_injection"?: VoiceCapabilityEvidence;
  "input_transcript"?: VoiceCapabilityEvidence;
  "interrupt_generation"?: VoiceCapabilityEvidence;
  "native_media"?: VoiceCapabilityEvidence;
  "output_transcript"?: VoiceCapabilityEvidence;
  "semantic_turn_taking"?: VoiceCapabilityEvidence;
  "typed_tools"?: VoiceCapabilityEvidence;
  "understand_input_during_output"?: VoiceCapabilityEvidence;
};
  "config_schema_version": number;
  "contract_version": number;
  "input_specs": Array<MediaSpec>;
  "label": string;
  "native_requirements"?: VoiceNativeRequirements | null;
  "output_specs": Array<MediaSpec>;
  "transports": Array<VoiceTransportPreference>;
};

export type VoiceApprovalAnswer = {
  "answer": string;
  "presented_context_id": string;
  "target": ApprovalTarget;
};

export type VoiceApprovalPresentation = {
  "question": string;
  "target": ApprovalTarget;
};

export type VoiceCapabilityEvidence = {
  "source": string;
  "support": CapabilitySupport;
};

export type VoiceCaptureState = "idle" | "capturing" | "paused" | "unavailable";

export type VoiceCloseReason = "user_ended" | "lease_revoked" | "binding_changed" | "device_unavailable" | "permission_revoked" | "network_lost" | "backlog" | "journal_unavailable" | "app_shutdown" | "model_limit" | "provider_failed";

export type VoiceConfigurationPatch = {
  "instructions": VoicePatch;
  "tools": VoicePatch2;
};

export type VoiceConnectionState = "opening" | "ready" | "recovering" | "closing" | "closed" | "failed";

export type VoiceContextPresentation = {
  "context_key": string;
  "target"?: WorkTarget | null;
};

export type VoiceControl = {
  "kind": "mute_input";
  "muted": boolean;
} | {
  "kind": "set_input_muted";
  "muted": boolean;
  "request_id": string;
} | {
  "fragment": TranscriptFragment;
  "kind": "present_input_source";
} | {
  "kind": "interrupt_output";
  "output_generation": number;
  "played"?: PlaybackReceipt | null;
} | {
  "kind": "update_configuration";
  "patch": VoiceConfigurationPatch;
} | {
  "fact": VerifiedVoiceFact;
  "kind": "inject_fact";
} | {
  "kind": "revoke_speech";
  "output_generation": number;
  "source": VoiceSpeechSourceRef;
} | {
  "kind": "reject_work_trigger";
  "reason": string;
  "upstream_trigger_id": string;
} | {
  "kind": "playback";
  "receipt": PlaybackReceipt;
} | {
  "kind": "close";
  "reason": VoiceCloseReason;
};

export type VoiceError = {
  "kind": VoiceErrorKind;
  "message": string;
  "retryable": boolean;
};

export type VoiceErrorKind = "configuration" | "unsupported" | "authentication" | "quota" | "network" | "deadline" | "backlog" | "stale_epoch" | "stale_binding" | "source_context_required" | "journal_unavailable" | "closed" | "provider";

export type VoiceFeature = "continuous_input" | "understand_input_during_output" | "semantic_turn_taking" | "fact_injection" | "typed_tools" | "delegation" | "input_transcript" | "output_transcript" | "interrupt_generation" | "exact_output_truncation" | "controlled_output_boundary" | "native_media";

export type VoiceInputSourceRef = {
  "fragment_id": string;
  "revision": number;
};

export type VoiceLocalFactRef = {
  "activation_epoch": number;
  "journal_sequence": number;
  "voice_session_id": string;
};

export type VoiceLocalReplay = {
  "entries": Array<VoiceLocalReplayEntry>;
  "scope": VoiceReplayScope;
};

export type VoiceLocalReplayEntry = {
  "fragment": TranscriptFragment;
  "kind": "user_committed";
  "origin": VoiceLocalFactRef;
} | {
  "kind": "playback";
  "origin": VoiceLocalFactRef;
  "receipt": PlaybackReceipt;
};

export type VoiceModelEvent = {
  "kind": "ready";
  "negotiation": VoiceNegotiation;
} | {
  "context_window_ref": string;
  "kind": "context_opened";
  "work_context"?: VoiceWorkContextFact | null;
} | {
  "canonical_receipt_id": string;
  "context_window_ref": string;
  "kind": "work_context_checkpoint";
  "media_range": MediaRange;
  "target"?: WorkTarget | null;
} | {
  "fragment": TranscriptFragment;
  "kind": "transcript";
} | {
  "kind": "output_started";
  "segment": OutputSegment;
} | {
  "frame": AudioFrame;
  "kind": "audio";
  "segment_id": string;
} | {
  "kind": "output_finished";
  "response_id": string;
} | {
  "kind": "output_interrupted";
  "response_id"?: string | null;
} | {
  "kind": "work_trigger";
  "trigger": WorkTrigger;
} | {
  "kind": "configuration_applied";
} | {
  "kind": "input_mute_applied";
  "muted": boolean;
  "request_id": string;
} | {
  "kind": "relay_recovering";
  "output_generation": number;
} | {
  "kind": "relay_recovered";
  "output_generation": number;
} | {
  "attachment_id"?: string | null;
  "kind": "output_boundary";
  "output_generation": number;
} | {
  "kind": "native_attachment_required";
  "output_generation": number;
} | {
  "error": VoiceError;
  "kind": "control_rejected";
} | {
  "error": VoiceError;
  "kind": "error";
} | {
  "kind": "closed";
  "termination": VoiceTermination;
};

export type VoiceNativeAttachment = {
  "answer_sdp": string;
  "attachment_id": string;
  "safe_output_boundary": boolean;
};

export type VoiceNativeRequirements = {
  "data_channel_label"?: string | null;
};

export type VoiceNegotiation = {
  "capabilities": {
  "continuous_input"?: VoiceCapabilityEvidence;
  "controlled_output_boundary"?: VoiceCapabilityEvidence;
  "delegation"?: VoiceCapabilityEvidence;
  "exact_output_truncation"?: VoiceCapabilityEvidence;
  "fact_injection"?: VoiceCapabilityEvidence;
  "input_transcript"?: VoiceCapabilityEvidence;
  "interrupt_generation"?: VoiceCapabilityEvidence;
  "native_media"?: VoiceCapabilityEvidence;
  "output_transcript"?: VoiceCapabilityEvidence;
  "semantic_turn_taking"?: VoiceCapabilityEvidence;
  "typed_tools"?: VoiceCapabilityEvidence;
  "understand_input_during_output"?: VoiceCapabilityEvidence;
};
  "input_spec"?: MediaSpec | null;
  "native_attachment"?: VoiceNativeAttachment | null;
  "output_spec"?: MediaSpec | null;
};

export type VoicePatch = {
  "op": "keep";
} | {
  "op": "clear";
} | {
  "op": "set";
  "value": string;
};

export type VoicePatch2 = {
  "op": "keep";
} | {
  "op": "clear";
} | {
  "op": "set";
  "value": Array<VoiceToolDefinition>;
};

export type VoicePlaybackState = "idle" | "playing" | "interrupted";

export type VoiceProductEvent = {
  "activation_epoch": number;
  "duration_us": number;
  "kind": "input_admitted";
  "sequence": number;
} | {
  "activation_epoch": number;
  "duration_us": number;
  "kind": "input_released";
  "sequence": number;
} | {
  "activation_epoch": number;
  "control": VoiceControl;
  "kind": "endpoint_control";
} | {
  "kind": "state";
  "state": VoiceState;
} | {
  "event": VoiceModelEvent;
  "kind": "model";
} | {
  "kind": "work_receipt";
  "receipt": VoiceWorkReceipt;
  "request_kind"?: VoiceWorkRequestKind | null;
  "upstream_trigger_id"?: string | null;
} | {
  "kind": "approval_presented";
  "presentation": VoiceApprovalPresentation;
} | {
  "kind": "source_context_changed";
  "requirement"?: VoiceSourceContextRequirement | null;
} | {
  "kind": "speech_revoked";
  "output_generation": number;
  "source_message_id": string;
  "source_revision": number;
};

export type VoiceProfile = {
  "agent_session_id": string;
  "binding_version": number;
  "enabled": boolean;
  "label": string;
  "profile_id": string;
  "revision": number;
  "route": VoiceRouteRecord;
  "work_steering_policy"?: WorkSteeringPolicy;
};

export type VoiceProfileProbeRequest = {
  "agent_session_id": string;
  "binding_version": number;
  "native_offer"?: string | null;
  "profile_revision": number;
};

export type VoiceProfileProbeResult = {
  "connection_verified": boolean;
  "negotiation": VoiceNegotiation;
  "profile_id": string;
  "profile_revision": number;
  "termination": VoiceTermination;
  "transport": VoiceTransportPreference;
};

export type VoiceProfileUpdate = {
  "adapter_config": unknown;
  "adapter_id"?: string | null;
  "agent_session_id": string;
  "binding_version": number;
  "connection_role"?: string;
  "enabled": boolean;
  "expected_revision": number;
  "model": string;
  "provider_id": string;
  "transport": VoiceTransportPreference;
  "work_steering_policy"?: WorkSteeringPolicy;
};

export type VoiceReplayScope = {
  "agent_session_id": string;
  "binding_version": number;
  "context_floor": number;
};

export type VoiceRouteIdentity = {
  "adapter_contract_ref": string;
  "record_digest": string;
  "revision": number;
  "route_id": string;
};

export type VoiceRouteRecord = {
  "adapter_config": unknown;
  "adapter_config_digest": string;
  "adapter_contract_version": number;
  "adapter_id": string;
  "connection_config_digest": string;
  "connection_config_ref": string;
  "credential_ref": string;
  "model": string;
  "model_revision": number;
  "provider_id": string;
  "required_features": Array<VoiceFeature>;
  "revision": number;
  "route_id": string;
  "schema": string;
  "transport": VoiceTransportPreference;
};

export type VoiceSourceContextConfirmation = {
  "activation_epoch": number;
  "context_key": string;
  "source_ref": VoiceInputSourceRef;
};

export type VoiceSourceContextRequirement = {
  "context": VoiceContextPresentation;
  "source_ref": VoiceInputSourceRef;
};

export type VoiceSpeaker = "user" | "assistant";

export type VoiceSpeechProjection = {
  "message_id": string;
  "revision": number;
  "text": string;
  "through_seq": number;
};

export type VoiceSpeechSourceRef = {
  "message_id": string;
  "revision": number;
  "through_seq": number;
};

export type VoiceState = {
  "activation_epoch": number;
  "agent_session_id": string;
  "binding_version": number;
  "capture": VoiceCaptureState;
  "connection": VoiceConnectionState;
  "output_generation": number;
  "playback": VoicePlaybackState;
  "voice_session_id": string;
  "work_running": boolean;
};

export type VoiceTermination = {
  "finalization_confirmed": boolean;
  "message"?: string | null;
  "reason": VoiceCloseReason;
};

export type VoiceToolDefinition = {
  "description": string;
  "name": string;
  "parameters": unknown;
};

export type VoiceTransportPreference = "relay" | "native_webrtc";

export type VoiceWorkCommand = {
  "activation_epoch": number;
  "operation_key": string;
  "request": VoiceWorkRequest;
};

export type VoiceWorkContextFact = {
  "target"?: WorkTarget | null;
};

export type VoiceWorkReceipt = {
  "duplicate": boolean;
  "first_claim_generation"?: number | null;
  "operation_key": string;
  "pending_input_id"?: string | null;
  "pending_input_revision"?: number | null;
  "receipt_id": string;
  "speech"?: VoiceSpeechProjection | null;
  "status": VoiceWorkStatus;
  "summary": string;
  "target"?: WorkTarget | null;
};

export type VoiceWorkRequest = {
  "action": "start";
  "text": string;
} | {
  "action": "steer";
  "target": WorkTarget;
  "text": string;
} | {
  "action": "observe";
  "target": WorkTarget;
} | {
  "action": "cancel";
  "target": WorkTarget;
} | {
  "action": "cancel_queued";
  "pending_input_id": string;
} | {
  "action": "revise_queued";
  "expected_revision": number;
  "pending_input_id": string;
  "text": string;
} | {
  "action": "answer_approval";
  "answer": VoiceApprovalAnswer;
};

export type VoiceWorkRequestKind = "start" | "steer" | "observe" | "cancel" | "cancel_queued" | "revise_queued" | "answer_approval";

export type VoiceWorkStatus = "accepted" | "applied" | "pending_boundary" | "rejected" | "deferred" | "queued" | "terminal";

export type WorkSteeringPolicy = "safe_boundary" | "supersede_model_step";

export type WorkTarget = {
  "agent_session_id": string;
  "binding_version": number;
  "execution_generation": number;
  "turn_operation_id": string;
};

export type WorkTrigger = {
  "arguments": unknown;
  "kind": "typed_tool_call";
  "name": string;
  "transcript_window_ref"?: string | null;
  "upstream_trigger_id": string;
} | {
  "context_window_ref"?: string | null;
  "kind": "delegation_trigger";
  "offset_ms": number;
  "target": string;
  "upstream_trigger_id": string;
};
