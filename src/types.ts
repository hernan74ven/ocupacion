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

export interface HistoryEntry {
  id: number;
  date: string;
  occupancyPercentage: string;
  cierrePaxTotal: number;
  cierreHab: number;
  state: {
    totalHab: string;
    ejecutivoGuardia: string;
    reportDate: string;
    data: Record<SectionName, OccupancySectionData>;
  };
}
