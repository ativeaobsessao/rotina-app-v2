export type EventStatus = 'waiting' | 'pending' | 'confirmed' | 'attention';
export type EventSyncStatus = 'synced' | 'pending' | 'failed';

export interface TimelineEventBase {
  id: string; // The config, period or activity ID
  type: 'meal' | 'medication_period' | 'activity';
  time: string; // '08:00:00'
  title: string;
  status: EventStatus;
  _syncStatus?: EventSyncStatus;
  _syncError?: string | null;
}

export interface MealEventData extends TimelineEventBase {
  type: 'meal';
  mealConfig: any; // MealConfig
  log?: any; // MealLog
  photoSignedUrl?: string | null;
}

export interface MedicationEventData extends TimelineEventBase {
  type: 'medication_period';
  period: any; // MedicationPeriod
  medications: any[]; // Array of Medications for this period
  logs: any[]; // Array of MedicationLogs for these medications
}

export interface ActivityEventData extends TimelineEventBase {
  type: 'activity';
  activity: any; // Activity row
  log?: any; // ActivityLog row
}

export type TimelineEvent = MealEventData | MedicationEventData | ActivityEventData;
