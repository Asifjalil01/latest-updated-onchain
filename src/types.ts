export type {
  AnalyticsSummary,
  BotRunState,
  BotSettings,
  BotStatusSnapshot,
  CandidateToken,
  ConfirmationLabel,
  ExecutionMode,
  ExitReason,
  ExplanationRecord,
  FeeBreakdown,
  HolderAccountInfo,
  LogEntry,
  LogSeverity,
  PaperVsLiveGapRecord,
  PositionExitSnapshot,
  PositionRecord,
  PositionStatus,
  PriorityFeePreset,
  RejectionRecord,
  RpcEndpointHealth,
  SecurityReport,
  SeenTokenRecord,
  SourceHealthRecord,
  StopLossTier,
  TokenClass,
  TradeRecord,
  TrailingTier,
  WalletDiagnostics,
  WalletFeeProfile,
} from '../server/types';

export interface SettingsHistoryEntry {
  id: number;
  field: string;
  oldValue: string;
  newValue: string;
  changedAtMs: number;
}

export interface ExecutionProgressEvent {
  mint: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  step: 'quote' | 'build' | 'sign' | 'send' | 'confirm' | 'reconcile' | 'done' | 'error';
  message: string;
  txSig?: string;
  timestampMs: number;
}

export type AppTab =
  | 'dashboard'
  | 'positions'
  | 'scanner'
  | 'shadow'
  | 'history'
  | 'settings'
  | 'wallets'
  | 'logs'
  | 'pipeline'
  | 'risk'
  | 'avgwin';
