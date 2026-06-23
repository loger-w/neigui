export interface OILTGroup { long: number; short: number; net: number }

export interface OptionsLargeTraders {
  contract: string;
  date: string;
  fetched_at: string;
  current: {
    top5_prop:  OILTGroup;
    top10_prop: OILTGroup;
    top5_all:   OILTGroup;
    top10_all:  OILTGroup;
  };
  series: Array<{ date: string; top10_all_net: number; top10_prop_net: number }>;
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
  call: StrikeRow[];
  put:  StrikeRow[];
  no_trading_day?: boolean;
}
