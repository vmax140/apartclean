export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_inspections: {
        Row: {
          cost_usd: number | null;
          created_at: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          input_tokens: number | null;
          model: string;
          output_tokens: number | null;
          overall_score: number | null;
          prompt_version: string;
          status: string;
          summary_for_cleaner: string | null;
          summary_for_owner: string | null;
          task_id: string;
          verdict: Database['public']['Enums']['ai_verdict'] | null;
        };
        ComputedFields: never;
        Insert: {
          cost_usd?: number | null;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          input_tokens?: number | null;
          model: string;
          output_tokens?: number | null;
          overall_score?: number | null;
          prompt_version: string;
          status?: string;
          summary_for_cleaner?: string | null;
          summary_for_owner?: string | null;
          task_id: string;
          verdict?: Database['public']['Enums']['ai_verdict'] | null;
        };
        Update: {
          cost_usd?: number | null;
          created_at?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          input_tokens?: number | null;
          model?: string;
          output_tokens?: number | null;
          overall_score?: number | null;
          prompt_version?: string;
          status?: string;
          summary_for_cleaner?: string | null;
          summary_for_owner?: string | null;
          task_id?: string;
          verdict?: Database['public']['Enums']['ai_verdict'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_inspections_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_photo_results: {
        Row: {
          checklist: NonNullable<Json>;
          confidence: number | null;
          fraud_flags: NonNullable<Json>;
          id: string;
          inspection_id: string;
          issues: NonNullable<Json>;
          model: string;
          photo_id: string;
          retake_request: string | null;
          score: number | null;
          verdict: Database['public']['Enums']['ai_verdict'];
        };
        ComputedFields: never;
        Insert: {
          checklist?: NonNullable<Json>;
          confidence?: number | null;
          fraud_flags?: NonNullable<Json>;
          id?: string;
          inspection_id: string;
          issues?: NonNullable<Json>;
          model: string;
          photo_id: string;
          retake_request?: string | null;
          score?: number | null;
          verdict: Database['public']['Enums']['ai_verdict'];
        };
        Update: {
          checklist?: NonNullable<Json>;
          confidence?: number | null;
          fraud_flags?: NonNullable<Json>;
          id?: string;
          inspection_id?: string;
          issues?: NonNullable<Json>;
          model?: string;
          photo_id?: string;
          retake_request?: string | null;
          score?: number | null;
          verdict?: Database['public']['Enums']['ai_verdict'];
        };
        Relationships: [
          {
            foreignKeyName: 'ai_photo_results_inspection_id_fkey';
            columns: ['inspection_id'];
            isOneToOne: false;
            referencedRelation: 'ai_inspections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_photo_results_photo_id_fkey';
            columns: ['photo_id'];
            isOneToOne: false;
            referencedRelation: 'task_photos';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          data: Json | null;
          entity: string;
          entity_id: string | null;
          id: number;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          data?: Json | null;
          entity: string;
          entity_id?: string | null;
          id?: never;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          data?: Json | null;
          entity?: string;
          entity_id?: string | null;
          id?: never;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      checklist_items: {
        Row: {
          id: string;
          label: string;
          requires_photo: boolean;
          room_type: Database['public']['Enums']['room_type'] | null;
          sort_order: number;
          template_id: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          label: string;
          requires_photo?: boolean;
          room_type?: Database['public']['Enums']['room_type'] | null;
          sort_order?: number;
          template_id: string;
        };
        Update: {
          id?: string;
          label?: string;
          requires_photo?: boolean;
          room_type?: Database['public']['Enums']['room_type'] | null;
          sort_order?: number;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'checklist_items_template_id_fkey';
            columns: ['template_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      checklist_templates: {
        Row: {
          id: string;
          name: string;
          property_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          name: string;
          property_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          property_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'checklist_templates_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_templates_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
        ];
      };
      cleaner_profiles: {
        Row: {
          base_price_rsd: number | null;
          bio: string | null;
          brings_supplies: boolean;
          completed_jobs: number;
          has_car: boolean;
          languages: string[];
          max_jobs_per_day: number;
          reliability_pct: number | null;
          user_id: string;
          verification: Database['public']['Enums']['verification_status'];
          verified_at: string | null;
          verified_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          base_price_rsd?: number | null;
          bio?: string | null;
          brings_supplies?: boolean;
          completed_jobs?: number;
          has_car?: boolean;
          languages?: string[];
          max_jobs_per_day?: number;
          reliability_pct?: number | null;
          user_id: string;
          verification?: Database['public']['Enums']['verification_status'];
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          base_price_rsd?: number | null;
          bio?: string | null;
          brings_supplies?: boolean;
          completed_jobs?: number;
          has_car?: boolean;
          languages?: string[];
          max_jobs_per_day?: number;
          reliability_pct?: number | null;
          user_id?: string;
          verification?: Database['public']['Enums']['verification_status'];
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'cleaner_profiles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaner_profiles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaner_profiles_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaner_profiles_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      cleaner_regions: {
        Row: {
          cleaner_id: string;
          region_id: number;
        };
        ComputedFields: never;
        Insert: {
          cleaner_id: string;
          region_id: number;
        };
        Update: {
          cleaner_id?: string;
          region_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'cleaner_regions_cleaner_id_fkey';
            columns: ['cleaner_id'];
            isOneToOne: false;
            referencedRelation: 'cleaner_profiles';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'cleaner_regions_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
        ];
      };
      cleaning_tasks: {
        Row: {
          accepted_at: string | null;
          arrival_distance_m: number | null;
          arrival_lat: number | null;
          arrival_lng: number | null;
          arrived_at: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          checklist_template_id: string | null;
          cleaner_id: string | null;
          completed_at: string | null;
          created_at: string;
          extras: NonNullable<Json>;
          id: string;
          owner_id: string;
          owner_notes: string | null;
          payment_status: Database['public']['Enums']['payment_status'];
          price_rsd: number | null;
          property_id: string;
          ready_at: string | null;
          reservation_id: string | null;
          status: Database['public']['Enums']['task_status'];
          submitted_at: string | null;
          type: Database['public']['Enums']['task_type'];
          updated_at: string;
          window_end: string;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          arrival_distance_m?: number | null;
          arrival_lat?: number | null;
          arrival_lng?: number | null;
          arrived_at?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          checklist_template_id?: string | null;
          cleaner_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          extras?: NonNullable<Json>;
          id?: string;
          owner_id: string;
          owner_notes?: string | null;
          payment_status?: Database['public']['Enums']['payment_status'];
          price_rsd?: number | null;
          property_id: string;
          ready_at?: string | null;
          reservation_id?: string | null;
          status?: Database['public']['Enums']['task_status'];
          submitted_at?: string | null;
          type?: Database['public']['Enums']['task_type'];
          updated_at?: string;
          window_end: string;
          window_start: string;
        };
        Update: {
          accepted_at?: string | null;
          arrival_distance_m?: number | null;
          arrival_lat?: number | null;
          arrival_lng?: number | null;
          arrived_at?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          checklist_template_id?: string | null;
          cleaner_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          extras?: NonNullable<Json>;
          id?: string;
          owner_id?: string;
          owner_notes?: string | null;
          payment_status?: Database['public']['Enums']['payment_status'];
          price_rsd?: number | null;
          property_id?: string;
          ready_at?: string | null;
          reservation_id?: string | null;
          status?: Database['public']['Enums']['task_status'];
          submitted_at?: string | null;
          type?: Database['public']['Enums']['task_type'];
          updated_at?: string;
          window_end?: string;
          window_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cleaning_tasks_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_checklist_template_id_fkey';
            columns: ['checklist_template_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_templates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_cleaner_id_fkey';
            columns: ['cleaner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_cleaner_id_fkey';
            columns: ['cleaner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cleaning_tasks_reservation_id_fkey';
            columns: ['reservation_id'];
            isOneToOne: false;
            referencedRelation: 'reservations';
            referencedColumns: ['id'];
          },
        ];
      };
      disputes: {
        Row: {
          created_at: string;
          id: string;
          opened_by: string;
          reason: string;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          opened_by: string;
          reason: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          task_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          opened_by?: string;
          reason?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'disputes_opened_by_fkey';
            columns: ['opened_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_opened_by_fkey';
            columns: ['opened_by'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disputes_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      legal_acceptances: {
        Row: {
          accepted_at: string;
          app_version: string | null;
          document_id: string;
          id: number;
          ip_address: unknown;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string;
          app_version?: string | null;
          document_id: string;
          id?: never;
          ip_address?: unknown;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          accepted_at?: string;
          app_version?: string | null;
          document_id?: string;
          id?: never;
          ip_address?: unknown;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'legal_acceptances_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'legal_documents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'legal_acceptances_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'legal_acceptances_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      legal_documents: {
        Row: {
          applies_to: Database['public']['Enums']['app_role'][] | null;
          content_md: string;
          content_sha256: string;
          id: string;
          is_active: boolean;
          kind: Database['public']['Enums']['legal_doc_kind'];
          published_at: string | null;
          title: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          applies_to?: Database['public']['Enums']['app_role'][] | null;
          content_md: string;
          content_sha256: string;
          id?: string;
          is_active?: boolean;
          kind: Database['public']['Enums']['legal_doc_kind'];
          published_at?: string | null;
          title: string;
          version: number;
        };
        Update: {
          applies_to?: Database['public']['Enums']['app_role'][] | null;
          content_md?: string;
          content_sha256?: string;
          id?: string;
          is_active?: boolean;
          kind?: Database['public']['Enums']['legal_doc_kind'];
          published_at?: string | null;
          title?: string;
          version?: number;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          attachment_path: string | null;
          body: string;
          created_at: string;
          id: string;
          read_at: string | null;
          sender_id: string;
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          attachment_path?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id: string;
          task_id: string;
        };
        Update: {
          attachment_path?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          body: string;
          created_at: string;
          data: NonNullable<Json>;
          id: string;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      preferred_cleaners: {
        Row: {
          cleaner_id: string;
          owner_id: string;
          priority: number;
        };
        ComputedFields: never;
        Insert: {
          cleaner_id: string;
          owner_id: string;
          priority?: number;
        };
        Update: {
          cleaner_id?: string;
          owner_id?: string;
          priority?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'preferred_cleaners_cleaner_id_fkey';
            columns: ['cleaner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'preferred_cleaners_cleaner_id_fkey';
            columns: ['cleaner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'preferred_cleaners_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'preferred_cleaners_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string;
          id: string;
          locale: string;
          phone: string | null;
          phone_verified_at: string | null;
          rating_avg: number | null;
          rating_count: number;
          status: Database['public']['Enums']['account_status'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name: string;
          id: string;
          locale?: string;
          phone?: string | null;
          phone_verified_at?: string | null;
          rating_avg?: number | null;
          rating_count?: number;
          status?: Database['public']['Enums']['account_status'];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          locale?: string;
          phone?: string | null;
          phone_verified_at?: string | null;
          rating_avg?: number | null;
          rating_count?: number;
          status?: Database['public']['Enums']['account_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          address: string;
          bathrooms: number | null;
          bedrooms: number | null;
          beds: number | null;
          checkin_time: string;
          checkout_time: string;
          cleaning_notes: string | null;
          complex_name: string | null;
          created_at: string;
          default_price_rsd: number | null;
          est_duration_min: number;
          geofence_m: number;
          id: string;
          is_active: boolean;
          lat: number;
          lng: number;
          max_guests: number | null;
          name: string;
          owner_id: string;
          region_id: number;
          size_m2: number | null;
        };
        ComputedFields: never;
        Insert: {
          address: string;
          bathrooms?: number | null;
          bedrooms?: number | null;
          beds?: number | null;
          checkin_time?: string;
          checkout_time?: string;
          cleaning_notes?: string | null;
          complex_name?: string | null;
          created_at?: string;
          default_price_rsd?: number | null;
          est_duration_min?: number;
          geofence_m?: number;
          id?: string;
          is_active?: boolean;
          lat: number;
          lng: number;
          max_guests?: number | null;
          name: string;
          owner_id: string;
          region_id: number;
          size_m2?: number | null;
        };
        Update: {
          address?: string;
          bathrooms?: number | null;
          bedrooms?: number | null;
          beds?: number | null;
          checkin_time?: string;
          checkout_time?: string;
          cleaning_notes?: string | null;
          complex_name?: string | null;
          created_at?: string;
          default_price_rsd?: number | null;
          est_duration_min?: number;
          geofence_m?: number;
          id?: string;
          is_active?: boolean;
          lat?: number;
          lng?: number;
          max_guests?: number | null;
          name?: string;
          owner_id?: string;
          region_id?: number;
          size_m2?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'properties_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'properties_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
        ];
      };
      property_access: {
        Row: {
          key_instructions: string | null;
          lockbox_code_encrypted: string | null;
          property_id: string;
          updated_at: string;
          wifi_name: string | null;
          wifi_password_encrypted: string | null;
        };
        ComputedFields: never;
        Insert: {
          key_instructions?: string | null;
          lockbox_code_encrypted?: string | null;
          property_id: string;
          updated_at?: string;
          wifi_name?: string | null;
          wifi_password_encrypted?: string | null;
        };
        Update: {
          key_instructions?: string | null;
          lockbox_code_encrypted?: string | null;
          property_id?: string;
          updated_at?: string;
          wifi_name?: string | null;
          wifi_password_encrypted?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_access_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: true;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_access_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: true;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
        ];
      };
      property_calendars: {
        Row: {
          ical_url: string;
          id: string;
          last_error: string | null;
          last_synced_at: string | null;
          property_id: string;
          source: string;
        };
        ComputedFields: never;
        Insert: {
          ical_url: string;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          property_id: string;
          source: string;
        };
        Update: {
          ical_url?: string;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          property_id?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'property_calendars_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_calendars_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
        ];
      };
      property_reports: {
        Row: {
          category: Database['public']['Enums']['report_category'];
          created_at: string;
          description: string;
          id: string;
          photo_ids: string[];
          property_id: string;
          reported_by: string;
          status: string;
          task_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          category: Database['public']['Enums']['report_category'];
          created_at?: string;
          description: string;
          id?: string;
          photo_ids?: string[];
          property_id: string;
          reported_by: string;
          status?: string;
          task_id?: string | null;
        };
        Update: {
          category?: Database['public']['Enums']['report_category'];
          created_at?: string;
          description?: string;
          id?: string;
          photo_ids?: string[];
          property_id?: string;
          reported_by?: string;
          status?: string;
          task_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'property_reports_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_reports_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_reports_reported_by_fkey';
            columns: ['reported_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_reports_reported_by_fkey';
            columns: ['reported_by'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_reports_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      property_rooms: {
        Row: {
          id: string;
          name: string;
          property_id: string;
          sort_order: number;
          type: Database['public']['Enums']['room_type'];
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          name: string;
          property_id: string;
          sort_order?: number;
          type: Database['public']['Enums']['room_type'];
        };
        Update: {
          id?: string;
          name?: string;
          property_id?: string;
          sort_order?: number;
          type?: Database['public']['Enums']['room_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'property_rooms_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'property_rooms_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
        ];
      };
      push_devices: {
        Row: {
          expo_push_token: string;
          id: string;
          last_seen_at: string;
          platform: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          expo_push_token: string;
          id?: string;
          last_seen_at?: string;
          platform: string;
          user_id: string;
        };
        Update: {
          expo_push_token?: string;
          id?: string;
          last_seen_at?: string;
          platform?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_devices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_devices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reference_photos: {
        Row: {
          angle_label: string | null;
          created_at: string;
          id: string;
          notes: string | null;
          property_id: string;
          room_id: string;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          angle_label?: string | null;
          created_at?: string;
          id?: string;
          notes?: string | null;
          property_id: string;
          room_id: string;
          storage_path: string;
        };
        Update: {
          angle_label?: string | null;
          created_at?: string;
          id?: string;
          notes?: string | null;
          property_id?: string;
          room_id?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reference_photos_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reference_photos_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reference_photos_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'property_rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      regions: {
        Row: {
          center_lat: number | null;
          center_lng: number | null;
          id: number;
          name: string;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          center_lat?: number | null;
          center_lng?: number | null;
          id?: number;
          name: string;
          slug: string;
        };
        Update: {
          center_lat?: number | null;
          center_lng?: number | null;
          id?: number;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      reservations: {
        Row: {
          calendar_id: string | null;
          check_in: string;
          check_out: string;
          external_uid: string;
          id: string;
          is_cancelled: boolean;
          property_id: string;
        };
        ComputedFields: never;
        Insert: {
          calendar_id?: string | null;
          check_in: string;
          check_out: string;
          external_uid: string;
          id?: string;
          is_cancelled?: boolean;
          property_id: string;
        };
        Update: {
          calendar_id?: string | null;
          check_in?: string;
          check_out?: string;
          external_uid?: string;
          id?: string;
          is_cancelled?: boolean;
          property_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reservations_calendar_id_fkey';
            columns: ['calendar_id'];
            isOneToOne: false;
            referencedRelation: 'property_calendars';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'properties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_property_id_fkey';
            columns: ['property_id'];
            isOneToOne: false;
            referencedRelation: 'property_cards';
            referencedColumns: ['id'];
          },
        ];
      };
      reviews: {
        Row: {
          comment: string | null;
          communication: number | null;
          created_at: string;
          direction: Database['public']['Enums']['review_direction'];
          id: string;
          published_at: string | null;
          punctuality: number | null;
          quality: number | null;
          rating: number;
          reviewee_id: string;
          reviewer_id: string;
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          comment?: string | null;
          communication?: number | null;
          created_at?: string;
          direction: Database['public']['Enums']['review_direction'];
          id?: string;
          published_at?: string | null;
          punctuality?: number | null;
          quality?: number | null;
          rating: number;
          reviewee_id: string;
          reviewer_id: string;
          task_id: string;
        };
        Update: {
          comment?: string | null;
          communication?: number | null;
          created_at?: string;
          direction?: Database['public']['Enums']['review_direction'];
          id?: string;
          published_at?: string | null;
          punctuality?: number | null;
          quality?: number | null;
          rating?: number;
          reviewee_id?: string;
          reviewer_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reviews_reviewee_id_fkey';
            columns: ['reviewee_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reviews_reviewee_id_fkey';
            columns: ['reviewee_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reviews_reviewer_id_fkey';
            columns: ['reviewer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reviews_reviewer_id_fkey';
            columns: ['reviewer_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reviews_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          id: string;
          owner_id: string;
          plan: string;
          properties_limit: number | null;
          provider: string | null;
          provider_ref: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          owner_id: string;
          plan?: string;
          properties_limit?: number | null;
          provider?: string | null;
          provider_ref?: string | null;
          status?: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          owner_id?: string;
          plan?: string;
          properties_limit?: number | null;
          provider?: string | null;
          provider_ref?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      task_checklist: {
        Row: {
          checklist_item_id: string | null;
          done_at: string | null;
          id: string;
          is_done: boolean;
          label: string;
          note: string | null;
          requires_photo: boolean;
          room_id: string | null;
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          checklist_item_id?: string | null;
          done_at?: string | null;
          id?: string;
          is_done?: boolean;
          label: string;
          note?: string | null;
          requires_photo?: boolean;
          room_id?: string | null;
          task_id: string;
        };
        Update: {
          checklist_item_id?: string | null;
          done_at?: string | null;
          id?: string;
          is_done?: boolean;
          label?: string;
          note?: string | null;
          requires_photo?: boolean;
          room_id?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_checklist_checklist_item_id_fkey';
            columns: ['checklist_item_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_checklist_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'property_rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_checklist_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      task_offers: {
        Row: {
          cleaner_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          message: string | null;
          proposed_price_rsd: number | null;
          responded_at: string | null;
          status: Database['public']['Enums']['offer_status'];
          task_id: string;
        };
        ComputedFields: never;
        Insert: {
          cleaner_id: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          message?: string | null;
          proposed_price_rsd?: number | null;
          responded_at?: string | null;
          status?: Database['public']['Enums']['offer_status'];
          task_id: string;
        };
        Update: {
          cleaner_id?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          message?: string | null;
          proposed_price_rsd?: number | null;
          responded_at?: string | null;
          status?: Database['public']['Enums']['offer_status'];
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_offers_cleaner_id_fkey';
            columns: ['cleaner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_offers_cleaner_id_fkey';
            columns: ['cleaner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_offers_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      task_photos: {
        Row: {
          captured_at: string;
          checklist_row_id: string | null;
          created_by: string;
          height: number | null;
          id: string;
          kind: Database['public']['Enums']['photo_kind'];
          lat: number | null;
          lng: number | null;
          phash: string | null;
          replaces_photo_id: string | null;
          room_id: string | null;
          sha256: string;
          storage_path: string;
          task_id: string;
          uploaded_at: string;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          captured_at: string;
          checklist_row_id?: string | null;
          created_by: string;
          height?: number | null;
          id?: string;
          kind?: Database['public']['Enums']['photo_kind'];
          lat?: number | null;
          lng?: number | null;
          phash?: string | null;
          replaces_photo_id?: string | null;
          room_id?: string | null;
          sha256: string;
          storage_path: string;
          task_id: string;
          uploaded_at?: string;
          width?: number | null;
        };
        Update: {
          captured_at?: string;
          checklist_row_id?: string | null;
          created_by?: string;
          height?: number | null;
          id?: string;
          kind?: Database['public']['Enums']['photo_kind'];
          lat?: number | null;
          lng?: number | null;
          phash?: string | null;
          replaces_photo_id?: string | null;
          room_id?: string | null;
          sha256?: string;
          storage_path?: string;
          task_id?: string;
          uploaded_at?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'task_photos_checklist_row_id_fkey';
            columns: ['checklist_row_id'];
            isOneToOne: false;
            referencedRelation: 'task_checklist';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_photos_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_photos_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_photos_replaces_photo_id_fkey';
            columns: ['replaces_photo_id'];
            isOneToOne: false;
            referencedRelation: 'task_photos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_photos_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'property_rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_photos_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'cleaning_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      user_roles: {
        Row: {
          granted_at: string;
          role: Database['public']['Enums']['app_role'];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          granted_at?: string;
          role: Database['public']['Enums']['app_role'];
          user_id: string;
        };
        Update: {
          granted_at?: string;
          role?: Database['public']['Enums']['app_role'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_roles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_roles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      verification_requests: {
        Row: {
          created_at: string;
          doc_front_path: string | null;
          document_type: string;
          files_deleted_at: string | null;
          id: string;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          selfie_path: string | null;
          status: Database['public']['Enums']['verification_status'];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          doc_front_path?: string | null;
          document_type: string;
          files_deleted_at?: string | null;
          id?: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          selfie_path?: string | null;
          status?: Database['public']['Enums']['verification_status'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          doc_front_path?: string | null;
          document_type?: string;
          files_deleted_at?: string | null;
          id?: string;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          selfie_path?: string | null;
          status?: Database['public']['Enums']['verification_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'verification_requests_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'verification_requests_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'verification_requests_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'verification_requests_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      property_cards: {
        Row: {
          complex_name: string | null;
          id: string;
          region_id: number;
        };
        ComputedFields: never;
        Insert: {
          complex_name?: string | null;
          id?: string | null;
          region_id?: number | null;
        };
        Update: {
          complex_name?: string | null;
          id?: string | null;
          region_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'properties_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
        ];
      };
      public_profiles: {
        Row: {
          avatar_url: string | null;
          full_name: string;
          id: string;
          is_verified: boolean | null;
          rating_avg: number | null;
          rating_count: number;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      account_is_active: { Args: Record<PropertyKey, never>; Returns: boolean };
      anonymize_account: { Args: { target_user: string }; Returns: undefined };
      cleaner_can_see_task: { Args: { target_task: string }; Returns: boolean };
      get_access_info: {
        Args: { target_task: string };
        Returns: {
          key_instructions: string;
          lockbox_code_encrypted: string;
          property_id: string;
          wifi_name: string;
          wifi_password_encrypted: string;
        }[];
      };
      has_role: {
        Args: { target_role: Database['public']['Enums']['app_role'] };
        Returns: boolean;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_assigned_cleaner: { Args: { target_task: string }; Returns: boolean };
      owns_property: { Args: { target_property: string }; Returns: boolean };
      owns_task: { Args: { target_task: string }; Returns: boolean };
      record_legal_acceptance: {
        Args: {
          client_agent: string;
          client_ip: unknown;
          client_version: string;
          document_ids: string[];
          target_user: string;
        };
        Returns: undefined;
      };
      require_adult_signup: { Args: { event: Json }; Returns: Json };
      safe_uuid: { Args: { value: string }; Returns: string };
      set_initial_roles: {
        Args: { roles: Database['public']['Enums']['app_role'][] };
        Returns: undefined;
      };
    };
    Enums: {
      account_status: 'pending' | 'active' | 'suspended' | 'deleted';
      ai_verdict: 'pass' | 'minor_issues' | 'fail' | 'unclear';
      app_role: 'owner' | 'cleaner' | 'admin';
      legal_doc_kind: 'terms' | 'privacy' | 'cleaner_rules' | 'owner_rules' | 'cancellation';
      offer_status: 'offered' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
      payment_status: 'unpaid' | 'paid_offline' | 'paid_online' | 'refunded';
      photo_kind: 'after' | 'damage' | 'fix';
      report_category: 'damage' | 'missing_item' | 'maintenance' | 'supplies_low';
      review_direction: 'owner_to_cleaner' | 'cleaner_to_owner';
      room_type:
        'bedroom' | 'bathroom' | 'kitchen' | 'living_room' | 'hallway' | 'balcony' | 'other';
      task_status:
        | 'draft'
        | 'open'
        | 'offered'
        | 'accepted'
        | 'in_progress'
        | 'submitted'
        | 'needs_fixes'
        | 'ready'
        | 'completed'
        | 'disputed'
        | 'cancelled'
        | 'expired';
      task_type: 'turnover' | 'deep_clean' | 'linen_only' | 'inspection';
      verification_status: 'unverified' | 'pending' | 'verified' | 'rejected';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_status: ['pending', 'active', 'suspended', 'deleted'],
      ai_verdict: ['pass', 'minor_issues', 'fail', 'unclear'],
      app_role: ['owner', 'cleaner', 'admin'],
      legal_doc_kind: ['terms', 'privacy', 'cleaner_rules', 'owner_rules', 'cancellation'],
      offer_status: ['offered', 'accepted', 'declined', 'expired', 'withdrawn'],
      payment_status: ['unpaid', 'paid_offline', 'paid_online', 'refunded'],
      photo_kind: ['after', 'damage', 'fix'],
      report_category: ['damage', 'missing_item', 'maintenance', 'supplies_low'],
      review_direction: ['owner_to_cleaner', 'cleaner_to_owner'],
      room_type: ['bedroom', 'bathroom', 'kitchen', 'living_room', 'hallway', 'balcony', 'other'],
      task_status: [
        'draft',
        'open',
        'offered',
        'accepted',
        'in_progress',
        'submitted',
        'needs_fixes',
        'ready',
        'completed',
        'disputed',
        'cancelled',
        'expired',
      ],
      task_type: ['turnover', 'deep_clean', 'linen_only', 'inspection'],
      verification_status: ['unverified', 'pending', 'verified', 'rejected'],
    },
  },
} as const;
