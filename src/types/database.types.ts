export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      families: { Row: any, Insert: any, Update: any },
      profiles: { Row: any, Insert: any, Update: any },
      patients: { Row: any, Insert: any, Update: any },
      meal_configs: { Row: any, Insert: any, Update: any },
      medications: { Row: any, Insert: any, Update: any },
      medication_periods: { Row: any, Insert: any, Update: any },
      meal_logs: { Row: any, Insert: any, Update: any },
      medication_logs: { Row: any, Insert: any, Update: any },
      daily_closures: { Row: any, Insert: any, Update: any },
      family_members: { Row: any, Insert: any, Update: any },
      family_invites: { Row: any, Insert: any, Update: any },
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_family_invite: {
        Args: Record<string, never>
        Returns: { invite_id: string, token: string, expires_at: string }
      }
      accept_family_invite: {
        Args: { p_token: string }
        Returns: { success: boolean, family_id: string }
      }
      revoke_family_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      set_active_family: {
        Args: { p_family_id: string }
        Returns: undefined
      }
      remove_family_member: {
        Args: { p_user_id: string, p_family_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}
