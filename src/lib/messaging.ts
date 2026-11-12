import type { VaultItem } from './vault';
import type { HistoryAnswer } from './history';
import type { DetectedField, PageContext } from './fieldDetector';
import type { GenerationUsage } from './usage';
export type { GenerationUsage } from './usage';

export interface AnswerSource {
  id: number;
  title: string;
  type: string;
  excerpt?: string;
}

export type OptionsTab = 'vault' | 'profiles' | 'history' | 'settings';

export type FieldErrorCode =
  | 'bad_key'
  | 'rate_limit'
  | 'no_vault'
  | 'vault_load_failed'
  | 'permission_denied'
  | 'timeout'
  | 'network'
  | 'no_connection'
  | 'api_error'
  | 'empty_response'
  | 'unknown';

export interface FieldError {
  message: string;
  code: FieldErrorCode;
  retryable: boolean;
  action?: {
    label: string;
    optionsTab: OptionsTab;
  };
}

export type StreamRequest =
  | {
      channel: 'sr_stream';
      type: 'start';
      requestId: string;
      prompt: string;
      systemPrompt: string;
      sources: AnswerSource[];
      maxOutputTokens?: number;
    }
  | { channel: 'sr_stream'; type: 'stop'; requestId: string };

export type StreamEvent =
  | { channel: 'sr_stream'; type: 'chunk'; requestId: string; text: string }
  | {
      channel: 'sr_stream';
      type: 'done';
      requestId: string;
      answer: string;
      sources: AnswerSource[];
      untraceableClaims: string[];
      usage?: GenerationUsage;
    }
  | {
      channel: 'sr_stream';
      type: 'error';
      requestId: string;
      error: string;
      code: 'bad_key' | 'rate_limit' | 'api_error' | 'network' | 'empty_response' | 'unknown';
      usage?: GenerationUsage;
    };

export type BackgroundRequest =
  | TestApiKeyRequest
  | ListModelsRequest
  | GetVaultItemsRequest
  | GetSimilarAnswersRequest
  | RecordAnswerRequest
  | SaveVaultItemRequest
  | GetHistoryRequest
  | DeleteHistoryRequest
  | ExportHistoryRequest
  | EnableSiteRequest
  | DisableSiteRequest;

export interface SaveVaultItemRequest {
  type: 'save_vault_item';
  itemType: VaultItem['type'];
  title: string;
  content: string;
  vaultProfileId?: string;
}

export interface TestApiKeyRequest {
  type: 'test_api_key';
  requestId: string;
  apiKey: string;
  model: string;
  provider: string;
}

export interface ModelOption {
  id: string;
  name?: string;
}

export interface ListModelsRequest {
  type: 'list_models';
  provider: string;
  apiKey?: string;
}

export interface ModelListResponse {
  type: 'model_list';
  provider: string;
  models: ModelOption[];
  error?: string;
}

export interface GetVaultItemsRequest {
  type: 'get_vault_items';
  vaultProfileId?: string;
}

export interface GetSimilarAnswersRequest {
  type: 'get_similar_answers';
  question: string;
  limit?: number;
}

export interface RecordAnswerRequest {
  type: 'record_answer';
  question: string;
  answer: string;
  sourceIds: number[];
  company?: string;
}

export interface GetHistoryRequest {
  type: 'get_history';
}

export interface DeleteHistoryRequest {
  type: 'delete_history_answer';
  id: number;
}

export interface ExportHistoryRequest {
  type: 'export_history_csv';
}

export interface EnableSiteRequest {
  type: 'enable_site';
  tabId: number;
  origin: string;
}

export interface DisableSiteRequest {
  type: 'disable_site';
  origin: string;
  tabId?: number;
}

export type BackgroundResponse =
  | TestApiKeyResult
  | ModelListResponse
  | VaultItemsResponse
  | SimilarAnswersResponse
  | RecordAnswerResponse
  | SaveVaultItemResponse
  | HistoryResponse
  | DeleteHistoryResponse
  | ExportHistoryResponse
  | SiteToggledResponse;

export interface SaveVaultItemResponse {
  type: 'vault_item_saved';
  id: number;
}

export interface TestApiKeyResult {
  type: 'test_api_key_result';
  requestId: string;
  success: boolean;
  message: string;
}

export interface VaultItemsResponse {
  type: 'vault_items';
  items: VaultItem[];
  profileId?: string;
  error?: string;
}

export interface SimilarAnswersResponse {
  type: 'similar_answers';
  items: HistoryAnswer[];
}

export interface RecordAnswerResponse {
  type: 'answer_recorded';
  id: number;
}

export interface HistoryResponse {
  type: 'history_items';
  items: HistoryAnswer[];
}

export interface DeleteHistoryResponse {
  type: 'history_deleted';
  id: number;
  deleted: boolean;
}

export interface ExportHistoryResponse {
  type: 'history_csv';
  csv: string;
  count: number;
}

export interface SiteToggledResponse {
  type: 'site_toggled';
  enabled: boolean;
  error?: string;
}

export type FieldStatus =
  | 'none'
  | 'drafting'
  | 'draft'
  | 'inserted'
  | 'skipped'
  | 'cancelled'
  | 'error';

export type AnswerProvenance = 'vault' | 'history' | 'llm';

export interface PanelFieldInfo {
  field: DetectedField;
  category: 'factual' | 'open_ended' | 'unknown';
  status: FieldStatus;
  source: AnswerProvenance | null;
  draft: string;
  sources: string[];
  flags: string[];
  approved: boolean;
  error: FieldError | null;
  usage: GenerationUsage | null;
  recovered: boolean;
  stale: boolean;
  recoveryValueFingerprint: string | null;
  sourceDetails: AnswerSource[];
}

export interface VaultProfileOption {
  id: string;
  name: string;
}

export type SidePanelRequest =
  | { type: 'get_panel_state' }
  | { type: 'scan_page' }
  | { type: 'answer_field'; fieldId: string }
  | { type: 'regenerate_answer'; fieldId: string }
  | { type: 'revise_field'; fieldId: string; instruction: string }
  | { type: 'update_field_draft'; fieldId: string; draft: string }
  | {
      type: 'restore_field_draft';
      fieldId: string;
      draft: string;
      source: AnswerProvenance | null;
      sources: string[];
      flags: string[];
      usage: GenerationUsage | null;
      stale: boolean;
      valueFingerprint: string;
      sourceDetails: AnswerSource[];
    }
  | { type: 'review_recovered_field'; fieldId: string }
  | { type: 'insert_field'; fieldId: string }
  | { type: 'set_field_approved'; fieldId: string; approved: boolean }
  | { type: 'skip_field'; fieldId: string }
  | { type: 'bulk_insert'; fieldIds: string[] }
  | { type: 'undo_bulk'; fieldIds: string[] }
  | { type: 'set_field_focus'; fieldId: string };

export type SidePanelEvent =
  | { type: 'questions_updated'; questions: PanelFieldInfo[] }
  | { type: 'answer_progress'; fieldId: string; text: string }
  | {
      type: 'answer_ready';
      fieldId: string;
      answer: string;
      sources: string[];
      sourceDetails: AnswerSource[];
      flags: string[];
      source: AnswerProvenance;
      usage?: GenerationUsage;
    }
  | { type: 'answer_inserted'; fieldId: string }
  | { type: 'answer_error'; fieldId: string; error: FieldError; usage?: GenerationUsage }
  | {
      type: 'vault_profile_changed';
      vaultProfileId: string;
      vaultProfiles: VaultProfileOption[];
      override: boolean;
    };

export type ContentRequest =
  | { type: 'scan_page' }
  | { type: 'get_panel_state' }
  | { type: 'answer_field'; fieldId: string }
  | { type: 'regenerate_answer'; fieldId: string }
  | { type: 'revise_field'; fieldId: string; instruction: string }
  | { type: 'update_field_draft'; fieldId: string; draft: string }
  | {
      type: 'restore_field_draft';
      fieldId: string;
      draft: string;
      source: AnswerProvenance | null;
      sources: string[];
      flags: string[];
      usage: GenerationUsage | null;
      stale: boolean;
      valueFingerprint: string;
      sourceDetails: AnswerSource[];
    }
  | { type: 'review_recovered_field'; fieldId: string }
  | { type: 'stop_generation' }
  | { type: 'insert_field'; fieldId: string }
  | { type: 'set_field_approved'; fieldId: string; approved: boolean }
  | { type: 'skip_field'; fieldId: string }
  | { type: 'answer_focused_field' }
  | { type: 'insert_last_draft' }
  | { type: 'fill_field'; fieldSelector: string; value: string }
  | { type: 'undo_fill'; fieldSelector: string }
  | { type: 'highlight_fields'; show: boolean }
  | { type: 'read_selection' }
  | { type: 'bulk_insert'; fieldIds: string[] }
  | { type: 'undo_bulk'; fieldIds: string[] }
  | { type: 'set_field_focus'; fieldId: string }
  | { type: 'undo_field'; fieldId: string }
  | { type: 'set_vault_profile'; profileId: string | null }
  | { type: 'teardown' }
  | { type: 'reinit' }
  | { type: 'sr_ping' }
  | { type: 'generate_document'; kind: 'cover_letter' | 'video_script' };

export type ContentResponse =
  | {
      type: 'panel_state';
      questions: PanelFieldInfo[];
      context: PageContext;
      vaultProfileId?: string;
      vaultProfiles?: VaultProfileOption[];
      vaultProfileOverride?: boolean;
      matchedProfileName?: string | null;
    }
  | { type: 'page_data'; fields: DetectedField[]; context: PageContext }
  | { type: 'fill_result'; fieldSelector: string; success: boolean }
  | { type: 'bulk_insert_result'; insertedFieldIds: string[] }
  | { type: 'undo_bulk_result'; revertedFieldIds: string[] }
  | { type: 'selection_text'; text: string };