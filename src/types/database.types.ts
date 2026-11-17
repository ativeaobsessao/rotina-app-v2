export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type FamilyRole = 'ADMIN' | 'MEMBER';
export type FamilyMemberType = 'FAMILY' | 'CAREGIVER';
export type MealConsumptionStatus = 'normal' | 'partial' | 'none';
export type MedicationLogStatus = 'administered' | 'not_administered';
export type MedicationFrequency = 'daily' | 'weekly';
export type DailyMoodType = 'happy' | 'calm' | 'tired' | 'sad' | 'agitated';
export type DailyPainLevel = 'none' | 'mild' | 'moderate' | 'severe';
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Database {
  public: {
    Tables: {
      families: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          email: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          family_id: string;
          name: string;
          email: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          email?: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      patients: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          photo_url: string | null;
          gender: 'M' | 'F' | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          photo_url?: string | null;
          gender?: 'M' | 'F' | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          photo_url?: string | null;
          gender?: 'M' | 'F' | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      meal_configs: {
        Row: {
          id: string;
          patient_id: string;
          name: string;
          type: string;
          scheduled_time: string;
          display_order: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          name: string;
          type: string;
          scheduled_time: string;
          display_order?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          name?: string;
          type?: string;
          scheduled_time?: string;
          display_order?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      medication_periods: {
        Row: {
          id: string;
          patient_id: string;
          name: string;
          scheduled_time: string;
          display_order: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          name: string;
          scheduled_time: string;
          display_order?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          name?: string;
          scheduled_time?: string;
          display_order?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      medications: {
        Row: {
          id: string;
          patient_id: string;
          medication_period_id: string;
          name: string;
          dosage: string;
          frequency: MedicationFrequency;
          weekday: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          medication_period_id: string;
          name: string;
          dosage: string;
          frequency: MedicationFrequency;
          weekday?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          medication_period_id?: string;
          name?: string;
          dosage?: string;
          frequency?: MedicationFrequency;
          weekday?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      meal_logs: {
        Row: {
          id: string;
          meal_config_id: string;
          patient_id: string;
          event_date: string;
          consumption_status: MealConsumptionStatus;
          description: string | null;
          drink_description: string | null;
          notes: string | null;
          photo_url: string | null;
          meal_time: string | null;
          created_by: string;
          created_at: string;
          updated_by: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meal_config_id: string;
          patient_id: string;
          event_date: string;
          consumption_status: MealConsumptionStatus;
          description?: string | null;
          drink_description?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          meal_time?: string | null;
          created_by: string;
          created_at?: string;
          updated_by: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meal_config_id?: string;
          patient_id?: string;
          event_date?: string;
          consumption_status?: MealConsumptionStatus;
          description?: string | null;
          drink_description?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          meal_time?: string | null;
          created_by?: string;
          created_at?: string;
          updated_by?: string;
          updated_at?: string;
        };
      };
      medication_logs: {
        Row: {
          id: string;
          medication_id: string;
          patient_id: string;
          event_date: string;
          status: MedicationLogStatus;
          reason: string | null;
          notes: string | null;
          administered_at: string | null;
          created_by: string;
          created_at: string;
          updated_by: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          medication_id: string;
          patient_id: string;
          event_date: string;
          status: MedicationLogStatus;
          reason?: string | null;
          notes?: string | null;
          administered_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_by: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          medication_id?: string;
          patient_id?: string;
          event_date?: string;
          status?: MedicationLogStatus;
          reason?: string | null;
          notes?: string | null;
          administered_at?: string | null;
          created_by?: string;
          created_at?: string;
          updated_by?: string;
          updated_at?: string;
        };
      };
      daily_closures: {
        Row: {
          id: string;
          family_id: string;
          patient_id: string;
          date: string;
          status: string;
          closed_by: string;
          closed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          patient_id: string;
          date: string;
          status?: string;
          closed_by: string;
          closed_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          patient_id?: string;
          date?: string;
          status?: string;
          closed_by?: string;
          closed_at?: string;
          created_at?: string;
        };
      };
      daily_mood_logs: {
        Row: {
          id: string;
          patient_id: string;
          family_id: string;
          date: string;
          mood: DailyMoodType;
          pain_level: DailyPainLevel;
          pain_locations: string[];
          notes: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          family_id: string;
          date: string;
          mood: DailyMoodType;
          pain_level: DailyPainLevel;
          pain_locations?: string[];
          notes?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          patient_id?: string;
          family_id?: string;
          date?: string;
          mood?: DailyMoodType;
          pain_level?: DailyPainLevel;
          pain_locations?: string[];
          notes?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      family_members: {
        Row: {
          id: string;
          family_id: string;
          user_id: string;
          role: FamilyRole;
          member_type: FamilyMemberType;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          user_id: string;
          role: FamilyRole;
          member_type?: FamilyMemberType;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          user_id?: string;
          role?: FamilyRole;
          member_type?: FamilyMemberType;
          created_at?: string;
        };
      };
      family_invites: {
        Row: {
          id: string;
          family_id: string;
          created_by: string;
          token_hash: string;
          status: InviteStatus;
          invited_name: string | null;
          member_type: FamilyMemberType;
          expires_at: string;
          accepted_by: string | null;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          created_by: string;
          token_hash: string;
          status?: InviteStatus;
          invited_name?: string | null;
          member_type?: FamilyMemberType;
          expires_at: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          created_by?: string;
          token_hash?: string;
          status?: InviteStatus;
          invited_name?: string | null;
          member_type?: FamilyMemberType;
          expires_at?: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_family_invite: {
        Args: { p_invited_name?: string | null; p_member_type?: FamilyMemberType };
        Returns: {
          invite_id: string;
          token: string;
          expires_at: string;
          invited_name: string | null;
          member_type: FamilyMemberType;
        };
      };
      accept_family_invite: {
        Args: { p_token: string };
        Returns: {
          success: boolean;
          family_id: string;
          role?: FamilyRole;
          member_type?: FamilyMemberType;
        };
      };
      revoke_family_invite: {
        Args: { p_invite_id: string };
        Returns: undefined;
      };
      delete_family_invite: {
        Args: { p_invite_id: string };
        Returns: undefined;
      };
      clear_family_invite_history: {
        Args: { p_family_id: string };
        Returns: number;
      };
      set_active_family: {
        Args: { p_family_id: string };
        Returns: undefined;
      };
      remove_family_member: {
        Args: { p_user_id: string; p_family_id: string };
        Returns: undefined;
      };
      update_family_member_role: {
        Args: { p_user_id: string; p_family_id: string; p_new_role: string };
        Returns: { success: boolean; user_id: string; role: string };
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
}
