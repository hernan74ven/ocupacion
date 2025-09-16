export interface OccupancySectionData {
  hab: string;
  adultos: string;
  ninos: string;
  infantes: string;
}

export type SectionName = 'amanecimos' | 'entradas' | 'salidas' | 'usoCasa' | 'complementarias';

export type ImageTheme = 'classic' | 'modern' | 'aquatic' | 'tropical' | 'elegant';

export type UiTheme = 'light' | 'dark';

export interface CalculatedResults {
    cierreHab: number;
    cierreAdultos: number;
    cierreNinos: number;
    cierreInfantes: number;
    cierrePaxTotal: number;
    occupancyPercentage: string;
}

export interface ToastState {
    message: string;
    type: 'success' | 'error' | 'info';
}

export interface HistoricalReport {
  id: string; // reportDate
  reportDate: string;
  totalHab: string;
  ejecutivoGuardia: string;
  data: Record<SectionName, OccupancySectionData>;
  analysis: string;
  results: CalculatedResults;
  createdAt: number;
}
