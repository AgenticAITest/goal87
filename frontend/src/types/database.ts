export type MemberStatus = 'pending' | 'active' | 'suspended'
export type TournamentStatus = 'draft' | 'open' | 'closed'
export type MatchStatus =
  | 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED'
  | 'FINISHED' | 'POSTPONED' | 'CANCELLED'

export interface Profile {
  id: string
  display_name: string
  email: string
  status: MemberStatus
  is_admin: boolean
  balance_idr: number
  created_at: string
}

export interface BalanceLedgerRow {
  id: string
  user_id: string
  adjusted_by: string
  previous_balance_idr: number
  new_balance_idr: number
  note: string | null
  created_at: string
}

export interface Tournament {
  id: string
  name: string
  api_competition_id: string | null
  api_season: number | null
  stake_idr: number
  start_at: string | null
  end_at: string | null
  status: TournamentStatus
  is_test: boolean
  created_at: string
}

export interface Match {
  id: string
  tournament_id: string
  api_match_id: number | null
  home_team: string
  away_team: string
  kickoff_at: string
  status: MatchStatus
  ft_home: number | null
  ft_away: number | null
  last_polled_at: string | null
  settled_at: string | null
  settled_by: string | null
  created_at: string
}

export interface Prediction {
  id: string
  user_id: string
  match_id: string
  predicted_home: number
  predicted_away: number
  submitted_at: string
  submitted_by: string
}

export interface LeaderboardRow {
  user_id: string
  display_name: string
  balance_idr: number
  first_correct_at: string | null
}

export interface Settlement {
  id: string
  match_id: string
  user_id: string
  amount_idr: number
  is_winner: boolean
  is_void: boolean
  voided_at: string | null
  voided_by: string | null
  created_at: string
}
