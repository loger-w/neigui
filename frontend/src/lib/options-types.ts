export interface OILTGroup { long: number; short: number; net: number }

export interface OptionsLargeTraders {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  current: {
    top5_prop:  OILTGroup;
    top10_prop: OILTGroup;
    top5_all:   OILTGroup;
    top10_all:  OILTGroup;
  };
  series: Array<{
    date: string;
    top5_all_net:   number;
    top10_all_net:  number;
    top5_prop_net:  number;
    top10_prop_net: number;
  }>;
  no_trading_day?: boolean;
}

export interface StrikeRow {
  strike: number;
  volume: number;
  oi: number;
  oi_change: number;
}

export interface OptionsStrikeVolume {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  call: StrikeRow[];
  put:  StrikeRow[];
  no_trading_day?: boolean;
}

export interface OptionsSpot {
  date: string;
  fetched_at: string;
  as_of_date: string | null;
  spot: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  no_trading_day?: boolean;
}
