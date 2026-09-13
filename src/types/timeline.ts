export type EventStatus = 'waiting' | 'pending' | 'confirmed' | 'attention';

export interface TimelineEventBase {
  id: string; // The config or period ID
  type: 'meal' | 'medication_period';
  time: string; // '08:00:00'
  title: string;
  status: EventStatus;
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

export type TimelineEvent = MealEventData | MedicationEventData;
