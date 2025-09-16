import React, { useState, useEffect, useMemo, useRef, useCallback, forwardRef } from 'react';
import type { OccupancySectionData, SectionName, ImageTheme, UiTheme, CalculatedResults, ToastState, HistoryEntry } from './types';
import { GoogleGenAI } from '@google/genai';

// @ts-ignore
import html2canvas from 'html2canvas';

// --- Gemini AI Initialization ---
const apiKey = import.meta.env.VITE_API_KEY;
let ai: GoogleGenAI | null = null;

// This message will be shown to the user if the API key is not configured on the server.
const API_KEY_ERROR_MESSAGE = 'La clave API (VITE_API_KEY) no está configurada en el servidor. Las funciones de IA están desactivadas.';

if (!apiKey) {
  console.error(API_KEY_ERROR_MESSAGE);
} else {
  ai = new GoogleGenAI({ apiKey });
}

// --- IndexedDB Database Helpers ---
const DB_NAME = 'HotelOccupancyDB';
const APP_STATE_STORE = 'appState';
const HISTORY_STORE = 'historyStore';
const DB_VERSION = 2; // Incremented version for schema change
const STATE_KEY = 'currentFormState';

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(new Error('Error opening IndexedDB.'));
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(APP_STATE_STORE)) {
                db.createObjectStore(APP_STATE_STORE);
            }
            if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
            }
        };
    });
};

const dbRequest = <T,>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    return new Promise((resolve, reject) => {
        openDB().then(db => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = action(store);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result as T);
        }).catch(reject);
    });
};

const getFromDB = <T,>(key: IDBValidKey): Promise<T | undefined> => dbRequest(APP_STATE_STORE, 'readonly', store => store.get(key));
const saveToDB = (key: IDBValidKey, value: any): Promise<void> => dbRequest(APP_STATE_STORE, 'readwrite', store => store.put(value, key));
const deleteFromDB = (key: IDBValidKey): Promise<void> => dbRequest(APP_STATE_STORE, 'readwrite', store => store.delete(key));

const getAllHistory = (): Promise<HistoryEntry[]> => dbRequest(HISTORY_STORE, 'readonly', store => store.getAll());
const saveHistory = (entry: HistoryEntry): Promise<void> => dbRequest(HISTORY_STORE, 'readwrite', store => store.add(entry));
const deleteHistory = (id: number): Promise<void> => dbRequest(HISTORY_STORE, 'readwrite', store => store.delete(id));


// --- HELPER & UI COMPONENTS ---

const StaggeredSection: React.FC<{ children: React.ReactNode, delay: number, className?: string }> = ({ children, delay, className = '' }) => {
    const [isAnimated, setIsAnimated] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setIsAnimated(true), delay);
        return () => clearTimeout(timer);
    }, [delay]);
    return <div className={`stagger-animation ${isAnimated ? 'animate' : ''} ${className}`}>{children}</div>;
};

const Particles: React.FC = () => {
    useEffect(() => {
        const container = document.getElementById('particles-container');
        if (!container || container.childElementCount > 0) return;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 30; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            const size = Math.random() * 10 + 5;
            p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-duration:${Math.random() * 20 + 10}s;animation-delay:${Math.random() * 5}s;`;
            fragment.appendChild(p);
        }
        container.appendChild(fragment);
    }, []);
    return <div id="particles-container" className="particles" />;
};

const Toast: React.FC<{ toast: ToastState | null, onDismiss: () => void }> = ({ toast, onDismiss }) => {
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(onDismiss, 3000);
            return () => clearTimeout(timer);
        }
    }, [toast, onDismiss]);
    if (!toast) return null;
    const icon = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' }[toast.type];
    return <div className={`toast p-4 rounded-lg shadow-lg flex items-center ${toast ? 'show' : ''} ${toast.type}`}><i className={`fas ${icon} toast-icon mr-3 text-2xl`}></i><span>{toast.message}</span></div>;
};

interface OccupancyInputSectionProps { title: string; icon: string; data: OccupancySectionData; paxTotal: number; sectionName: SectionName; onDataChange: (section: SectionName, field: keyof OccupancySectionData, value: string) => void; onResetSection: (section: SectionName) => void; }
const OccupancyInputSection: React.FC<OccupancyInputSectionProps> = ({ title, icon, data, paxTotal, sectionName, onDataChange, onResetSection }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => { const { name, value } = e.target; onDataChange(sectionName, name as keyof OccupancySectionData, value); };
    return (
        <div className="section-box p-6 rounded-2xl shadow-lg transition-all duration-300 ease-out">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold flex items-center"><i className={`fas ${icon} mr-2`}></i> {title}</h2>
                <button onClick={() => onResetSection(sectionName)} className="text-sm transition-colors duration-200 hover:text-white" style={{ color: 'var(--text-color-tertiary)' }} title={`Reiniciar sección ${title}`}><i className="fas fa-undo"></i></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
                {(Object.keys(data) as Array<keyof OccupancySectionData>).map((key) => (
                    <div className="input-group" key={key}>
                        <label htmlFor={`${sectionName}${key}`} className="block text-sm font-medium capitalize" style={{ color: 'var(--text-color-secondary)' }}>{key === 'hab' ? 'Habitaciones' : key}</label>
                        <input type="number" id={`${sectionName}${key}`} name={key} value={data[key]} onChange={handleChange} min="0" className="mt-1 block w-full rounded-lg p-3 transition-all duration-300 ease-out" />
                    </div>
                ))}
                <div className="input-group">
                    <label className="block text-sm font-medium" style={{ color: 'var(--text-color-secondary)' }}>Total PAX:</label>
                    <input type="text" disabled value={paxTotal} className="mt-1 block w-full rounded-lg p-3 cursor-not-allowed" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-disabled)' }} />
                </div>
            </div>
        </div>
    );
};

interface ImageTemplateProps { data: Record<SectionName, OccupancySectionData>; paxTotals: Record<SectionName, number>; results: CalculatedResults; ejecutivo: string; isUpdate: boolean; imageTheme: ImageTheme; reportDate: string; }
const ImageTemplate = forwardRef<HTMLDivElement, ImageTemplateProps>(({ data, paxTotals, results, ejecutivo, isUpdate, imageTheme, reportDate }, ref) => {
    const themeClass = `image-theme-${imageTheme}`;
    const formattedDate = new Date(`${reportDate}T00:00:00`).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    return (
        <div ref={ref} className={`${themeClass} flex flex-col p-8 rounded-2xl`} style={{ width: '1080px', height: '1920px', background: 'var(--image-bg)' }}>
            {isUpdate && <div className="w-full text-center font-extrabold text-5xl mb-4 uppercase" style={{ color: 'var(--image-highlight)' }}>Actualización</div>}
            <div className="flex-grow flex flex-col items-center justify-start px-12 pt-12" style={{ color: 'var(--image-text)' }}>
                <div className="w-full text-center mb-10">
                    <h1 className="text-6xl font-extrabold mb-2">Pronóstico de Ocupación - HHPA</h1>
                    <p className="text-5xl font-bold mb-4">{formattedDate}</p>
                </div>
                {ejecutivo && (
                    <div className="w-full text-center mb-10">
                        <p className="text-4xl font-bold" style={{ color: 'var(--image-section)' }}>Ejecutivo de Guardia:</p>
                        <p className="text-5xl font-extrabold">{ejecutivo}</p>
                    </div>
                )}
                {Object.entries(data).map(([key, value]) => {
                    const titles: Record<SectionName, string> = { amanecimos: 'Amanecimos 🌅', entradas: 'Entradas 🚶‍♀️', salidas: 'Salidas 🚶‍♂️', usoCasa: 'Uso Casa 🏡', complementarias: 'Complementarias ➕' };
                    return (
                        <div key={key} className="w-full mb-6 p-6 rounded-2xl shadow-lg" style={{ backgroundColor: 'var(--image-card-bg)' }}>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-5xl font-black">{titles[key as SectionName]}</h2>
                                <p className="text-4xl font-black">PAX: <span>{paxTotals[key as SectionName]}</span></p>
                            </div>
                            <div className="text-4xl font-medium">
                                <div className="mb-2" style={{ color: 'var(--image-section)' }}>Habitaciones: <span className="font-bold" style={{ color: 'var(--image-text)' }}>{value.hab}</span></div>
                                <div className="flex space-x-8">
                                    <div style={{ color: 'var(--image-section)' }} className="flex items-center">Adultos:<span className="ml-2 text-3xl">👨</span><span className="font-bold ml-1" style={{ color: 'var(--image-text)' }}>{value.adultos}</span></div>
                                    <div style={{ color: 'var(--image-section)' }} className="flex items-center">Niños:<span className="ml-2 text-3xl">👦</span><span className="font-bold ml-1" style={{ color: 'var(--image-text)' }}>{value.ninos}</span></div>
                                    <div style={{ color: 'var(--image-section)' }} className="flex items-center">Infantes:<span className="ml-2 text-3xl">👶</span><span className="font-bold ml-1" style={{ color: 'var(--image-text)' }}>{value.infantes}</span></div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div className="w-full mt-6 p-6 rounded-2xl shadow-lg" style={{ backgroundColor: 'var(--image-card-bg)' }}>
                    <h2 className="text-5xl font-black mb-4 flex items-center">Cierre del Día <span className="ml-2">🌙</span></h2>
                    <div className="grid grid-cols-2 gap-y-4 text-4xl font-medium mb-8">
                        <div className="col-span-2" style={{ color: 'var(--image-section)' }}>Hab. Ocupadas: <span className="font-bold" style={{ color: 'var(--image-text)' }}>{results.cierreHab}</span></div>
                        <div className="col-span-2" style={{ color: 'var(--image-section)' }}>Adultos: <span className="font-bold" style={{ color: 'var(--image-text)' }}>{results.cierreAdultos}</span></div>
                        <div className="col-span-2" style={{ color: 'var(--image-section)' }}>Niños: <span className="font-bold" style={{ color: 'var(--image-text)' }}>{results.cierreNinos}</span></div>
                        <div className="col-span-2" style={{ color: 'var(--image-section)' }}>Infantes: <span className="font-bold" style={{ color: 'var(--image-text)' }}>{results.cierreInfantes}</span></div>
                        <div className="col-span-2 text-5xl font-bold" style={{ color: 'var(--image-section)' }}>Total PAX: <span style={{ color: 'var(--image-text)' }}>{results.cierrePaxTotal}</span></div>
                    </div>
                    <div className="pt-8 border-t" style={{ borderColor: 'var(--image-section)' }}>
                        <p className="text-5xl font-bold text-center" style={{ color: 'var(--image-section)' }}>Ocupación: <span className="font-extrabold" style={{ color: 'var(--image-highlight)' }}>{results.occupancyPercentage}</span></p>
                    </div>
                </div>
            </div>
            <p className="text-center text-3xl font-light mt-auto" style={{ color: 'var(--image-section)' }}>Generado por la App de Ocupación Hotelera</p>
        </div>
    );
});

const ThemePreview: React.FC<{ theme: ImageTheme }> = ({ theme }) => {
    const themeClass = `image-theme-${theme}`;
    return (
        <div className={`w-24 h-16 rounded-lg p-1.5 shadow-inner flex flex-col justify-between ${themeClass} transition-all duration-300`}>
            <div className="h-3 rounded-sm" style={{ background: 'var(--image-highlight)' }}></div>
            <div className="flex-grow flex flex-col items-center justify-center space-y-1 p-1">
                <div className="w-10/12 h-1.5 rounded-full" style={{ backgroundColor: 'var(--image-text)' }}></div>
                <div className="w-8/12 h-1.5 rounded-full opacity-75" style={{ backgroundColor: 'var(--image-text)' }}></div>
            </div>
            <div className="h-1.5 rounded-sm" style={{ backgroundColor: 'var(--image-section)' }}></div>
        </div>
    );
};

// --- HISTORY PANEL COMPONENT ---
const ITEMS_PER_PAGE = 5;

type SortKey = 'date' | 'occupancy';
type SortDirection = 'asc' | 'desc';

interface HistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    history: HistoryEntry[];
    onLoad: (entry: HistoryEntry) => void;
    onDelete: (id: number) => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ isOpen, onClose, history, onLoad, onDelete }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [currentPage, setCurrentPage] = useState(1);

    const filteredAndSortedHistory = useMemo(() => {
        return history
            .filter(entry => {
                const entryDate = new Date(entry.date + 'T00:00:00');
                const start = startDate ? new Date(startDate + 'T00:00:00') : null;
                const end = endDate ? new Date(endDate + 'T00:00:00') : null;

                if (start && entryDate < start) return false;
                if (end && entryDate > end) return false;

                const searchLower = searchTerm.toLowerCase();
                return entry.date.includes(searchLower) || entry.state.ejecutivoGuardia.toLowerCase().includes(searchLower);
            })
            .sort((a, b) => {
                let comparison = 0;
                if (sortKey === 'date') {
                    comparison = new Date(b.date).getTime() - new Date(a.date).getTime();
                } else {
                    comparison = parseFloat(b.occupancyPercentage) - parseFloat(a.occupancyPercentage);
                }
                return sortDirection === 'asc' ? -comparison : comparison;
            });
    }, [history, searchTerm, startDate, endDate, sortKey, sortDirection]);

    const totalPages = Math.ceil(filteredAndSortedHistory.length / ITEMS_PER_PAGE);
    const paginatedHistory = filteredAndSortedHistory.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    useEffect(() => {
        setCurrentPage(1);
    }, [filteredAndSortedHistory.length]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDirection('desc');
        }
    };

    const clearFilters = () => {
        setSearchTerm('');
        setStartDate('');
        setEndDate('');
    };

    return (
        <div className={`history-panel-overlay ${isOpen ? 'show' : ''}`} onClick={onClose}>
            <div className={`history-panel ${isOpen ? 'show' : ''}`} onClick={e => e.stopPropagation()}>
                <div className="history-panel-header">
                    <h2 className="text-2xl font-bold">Historial de Cálculos</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10"><i className="fas fa-times"></i></button>
                </div>

                <div className="history-controls">
                    <div className="input-group relative mb-4">
                        <input type="text" placeholder="Buscar por fecha o ejecutivo..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full p-2 pl-8 rounded-lg" />
                        <i className="fas fa-search absolute left-2.5 top-2.5" style={{ color: 'var(--text-color-tertiary)' }}></i>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="input-group"><label className="text-xs">Desde:</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 rounded-lg" /></div>
                        <div className="input-group"><label className="text-xs">Hasta:</label><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2 rounded-lg" /></div>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center space-x-2">
                            <span className="text-sm">Ordenar por:</span>
                            <button onClick={() => handleSort('date')} className={`px-3 py-1 text-sm rounded-lg ${sortKey === 'date' ? 'active' : ''}`}>Fecha {sortKey === 'date' && <i className={`fas fa-arrow-${sortDirection === 'desc' ? 'down' : 'up'}`}></i>}</button>
                            <button onClick={() => handleSort('occupancy')} className={`px-3 py-1 text-sm rounded-lg ${sortKey === 'occupancy' ? 'active' : ''}`}>Ocup. {sortKey === 'occupancy' && <i className={`fas fa-arrow-${sortDirection === 'desc' ? 'down' : 'up'}`}></i>}</button>
                        </div>
                        <button onClick={clearFilters} className="text-sm text-sky-400 hover:underline">Limpiar filtros</button>
                    </div>
                </div>

                <div className="history-list">
                    {paginatedHistory.length > 0 ? paginatedHistory.map(entry => (
                        <div key={entry.id} className="history-item">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-bold">{new Date(entry.date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
                                    <p className="text-sm" style={{ color: 'var(--text-color-secondary)' }}>Ejecutivo: {entry.state.ejecutivoGuardia || 'N/A'}</p>
                                </div>
                                <div className="flex space-x-2">
                                    <button onClick={() => onLoad(entry)} title="Cargar" className="p-2 rounded-full hover:bg-white/10 text-sky-400"><i className="fas fa-upload"></i></button>
                                    <button onClick={() => onDelete(entry.id)} title="Eliminar" className="p-2 rounded-full hover:bg-white/10 text-red-400"><i className="fas fa-trash"></i></button>
                                </div>
                            </div>
                            <div className="mt-2 pt-2 border-t border-white/10 text-sm grid grid-cols-3 gap-2">
                                <span><i className="fas fa-chart-pie mr-1"></i> {entry.occupancyPercentage}</span>
                                <span><i className="fas fa-users mr-1"></i> {entry.cierrePaxTotal} PAX</span>
                                <span><i className="fas fa-bed mr-1"></i> {entry.cierreHab} Hab.</span>
                            </div>
                        </div>
                    )) : <p className="text-center p-8" style={{ color: 'var(--text-color-tertiary)' }}>No hay entradas en el historial que coincidan con los filtros.</p>}
                </div>

                {totalPages > 1 && (
                    <div className="history-footer flex justify-between items-center">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-4 py-2 rounded-lg disabled:opacity-50">Anterior</button>
                        <span className="text-sm">Página {currentPage} de {totalPages}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-4 py-2 rounded-lg disabled:opacity-50">Siguiente</button>
                    </div>
                )}
            </div>
        </div>
    );
};


// --- CONSTANTS & INITIAL STATE ---
const initialState = { totalHab: '148', ejecutivoGuardia: '', reportDate: new Date().toISOString().split('T')[0], data: { amanecimos: { hab: '0', adultos: '0', ninos: '0', infantes: '0' }, entradas: { hab: '0', adultos: '0', ninos: '0', infantes: '0' }, salidas: { hab: '0', adultos: '0', ninos: '0', infantes: '0' }, usoCasa: { hab: '0', adultos: '0', ninos: '0', infantes: '0' }, complementarias: { hab: '0', adultos: '0', ninos: '0', infantes: '0' } } };

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [totalHab, setTotalHab] = useState(initialState.totalHab);
    const [ejecutivoGuardia, setEjecutivoGuardia] = useState(initialState.ejecutivoGuardia);
    const [reportDate, setReportDate] = useState(initialState.reportDate);
    const [data, setData] = useState<Record<SectionName, OccupancySectionData>>(initialState.data);

    const [uiTheme, setUiTheme] = useState<UiTheme>('dark');
    const [imageTheme, setImageTheme] = useState<ImageTheme>('classic');
    const [isUpdate, setIsUpdate] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysis, setAnalysis] = useState('');
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [totalHabError, setTotalHabError] = useState('');
    const imageTemplateRef = useRef<HTMLDivElement>(null);

    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

    const showToast = useCallback((message: string, type: ToastState['type']) => { setToast({ message, type }); }, []);

    useEffect(() => {
        const loadInitialState = async () => {
            try {
                const [savedState, savedHistory] = await Promise.all([getFromDB<any>(STATE_KEY), getAllHistory()]);
                if (savedState) {
                    setTotalHab(savedState.totalHab || initialState.totalHab);
                    setEjecutivoGuardia(savedState.ejecutivoGuardia || initialState.ejecutivoGuardia);
                    setData(savedState.data || initialState.data);
                    setReportDate(savedState.reportDate || initialState.reportDate);
                }
                setHistory(savedHistory.sort((a, b) => b.id - a.id));
            } catch (error) {
                console.error("Failed to load data from IndexedDB", error);
                showToast('No se pudieron cargar los datos guardados.', 'error');
            }
        };
        loadInitialState();
        setUiTheme(localStorage.getItem('theme') as UiTheme || 'dark');
    }, [showToast]);

    useEffect(() => {
        const handler = setTimeout(() => saveToDB(STATE_KEY, { totalHab, ejecutivoGuardia, data, reportDate }), 500);
        return () => clearTimeout(handler);
    }, [totalHab, ejecutivoGuardia, data, reportDate]);

    useEffect(() => {
        document.body.classList.toggle('light-mode', uiTheme === 'light');
        localStorage.setItem('theme', uiTheme);
    }, [uiTheme]);

    useEffect(() => {
        const num = parseInt(totalHab);
        setTotalHabError(isNaN(num) || num <= 0 ? 'Debe ser un número mayor que 0.' : '');
    }, [totalHab]);

    const handleDataChange = useCallback((section: SectionName, field: keyof OccupancySectionData, value: string) => {
        setData(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
    }, []);

    const handleResetSection = useCallback((sectionName: SectionName) => {
        setData(prev => ({ ...prev, [sectionName]: initialState.data.amanecimos }));
        showToast(`Sección ${sectionName} reiniciada`, 'info');
    }, [showToast]);

    const handleClearForm = useCallback(async () => {
        setTotalHab(initialState.totalHab);
        setEjecutivoGuardia(initialState.ejecutivoGuardia);
        setData(initialState.data);
        setReportDate(initialState.reportDate);
        setAnalysis('');
        try {
            await deleteFromDB(STATE_KEY);
            showToast('Formulario limpiado', 'info');
        } catch (error) {
            console.error('Failed to clear data from IndexedDB', error);
            showToast('Error al limpiar el formulario', 'error');
        }
    }, [showToast]);

    const paxTotals = useMemo(() => (Object.keys(data) as SectionName[]).reduce((acc, section) => {
        const { adultos, ninos, infantes } = data[section];
        acc[section] = (parseInt(adultos) || 0) + (parseInt(ninos) || 0) + (parseInt(infantes) || 0);
        return acc;
    }, {} as Record<SectionName, number>), [data]);

    const results = useMemo<CalculatedResults>(() => {
        const d = Object.fromEntries(Object.entries(data).map(([sec, vals]) => [sec, Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, parseInt(v) || 0]))])) as Record<SectionName, { [key in keyof OccupancySectionData]: number }>;
        const cierreHab = d.amanecimos.hab - d.salidas.hab + d.entradas.hab + d.usoCasa.hab + d.complementarias.hab;
        const cierreAdultos = d.amanecimos.adultos - d.salidas.adultos + d.entradas.adultos + d.usoCasa.adultos + d.complementarias.adultos;
        const cierreNinos = d.amanecimos.ninos - d.salidas.ninos + d.entradas.ninos + d.usoCasa.ninos + d.complementarias.ninos;
        const cierreInfantes = d.amanecimos.infantes - d.salidas.infantes + d.entradas.infantes + d.usoCasa.infantes + d.complementarias.infantes;
        const cierrePaxTotal = cierreAdultos + cierreNinos + cierreInfantes;
        const occupancy = totalHabError ? 0 : (cierreHab / (parseInt(totalHab) || 1)) * 100;
        return { cierreHab, cierreAdultos, cierreNinos, cierreInfantes, cierrePaxTotal, occupancyPercentage: `${occupancy.toFixed(2)}%` };
    }, [data, totalHab, totalHabError]);

    const saveCurrentCalculationToHistory = useCallback(async () => {
        const newEntry: HistoryEntry = {
            id: Date.now(), date: reportDate,
            occupancyPercentage: results.occupancyPercentage,
            cierrePaxTotal: results.cierrePaxTotal, cierreHab: results.cierreHab,
            state: { totalHab, ejecutivoGuardia, reportDate, data }
        };
        try {
            await saveHistory(newEntry);
            setHistory(prev => [newEntry, ...prev].sort((a, b) => b.id - a.id));
            showToast('Cálculo guardado en el historial.', 'success');
        } catch (error) {
            console.error("Failed to save history:", error);
            showToast('Error al guardar en el historial.', 'error');
        }
    }, [data, ejecutivoGuardia, reportDate, results, showToast, totalHab]);

    const handleGenerateAnalysis = async () => {
        if (!ai) {
            showToast(API_KEY_ERROR_MESSAGE, 'error');
            return;
        }

        setIsAnalyzing(true);
        setAnalysis('');
        showToast('La IA está analizando los datos...', 'info');
        const prompt = `Eres un asistente virtual para gerentes del Hotel Hesperia Playa El Agua. Tu tono es profesional, conciso y motivador. No uses markdown. Analiza los siguientes datos de ocupación del día y genera un breve resumen de 2 a 3 frases. Fecha: ${new Date(reportDate + 'T00:00:00').toLocaleDateString('es-ES')}, Ocupación: ${results.occupancyPercentage}, Habitaciones: ${results.cierreHab}/${totalHab}, Huéspedes: ${results.cierrePaxTotal}, Entradas: ${paxTotals.entradas} pax, Salidas: ${paxTotals.salidas} pax. Enfócate en puntos clave y finaliza con una nota positiva.`;
        try {
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setAnalysis(response.text);
            showToast('Análisis generado con éxito', 'success');
            await saveCurrentCalculationToHistory();
        } catch (error) {
            console.error('Error generating analysis:', error);
            showToast('Error al contactar la IA.', 'error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleGenerateImage = async () => {
        if (!imageTemplateRef.current) {
            showToast('Error: Plantilla no encontrada.', 'error');
            return;
        }
        setIsLoading(true);
        setGeneratedImage(null);
        try {
            await new Promise(r => setTimeout(r, 100));
            const canvas = await html2canvas(imageTemplateRef.current, { scale: 1, backgroundColor: null, useCORS: true });
            setGeneratedImage(canvas.toDataURL('image/png'));
            showToast('Imagen generada con éxito', 'success');
            await saveCurrentCalculationToHistory();
        } catch (error) {
            console.error('Error generating image:', error);
            showToast('Error al generar la imagen', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadHistory = (entry: HistoryEntry) => {
        setTotalHab(entry.state.totalHab);
        setEjecutivoGuardia(entry.state.ejecutivoGuardia);
        setData(entry.state.data);
        setReportDate(entry.state.reportDate);
        setIsHistoryPanelOpen(false);
        showToast(`Datos del ${new Date(entry.date + 'T00:00:00').toLocaleDateString('es-ES')} cargados.`, 'info');
    };

    const handleDeleteHistory = async (id: number) => {
        try {
            await deleteHistory(id);
            setHistory(prev => prev.filter(item => item.id !== id));
            showToast('Entrada del historial eliminada.', 'success');
        } catch (error) {
            console.error('Error deleting history:', error);
            showToast('Error al eliminar del historial.', 'error');
        }
    };
    
    const toggleTheme = () => {
        setUiTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
        showToast(`Tema ${uiTheme === 'dark' ? 'claro' : 'oscuro'} activado`, 'info');
    };

    const sections: { name: SectionName, title: string, icon: string }[] = [
        { name: 'amanecimos', title: 'Amanecimos', icon: 'fa-sun text-yellow-400' },
        { name: 'entradas', title: 'Entradas', icon: 'fa-sign-in-alt text-green-400' },
        { name: 'salidas', title: 'Salidas', icon: 'fa-sign-out-alt text-red-400' },
        { name: 'usoCasa', title: 'Uso Casa', icon: 'fa-home text-blue-400' },
        { name: 'complementarias', title: 'Complementarias', icon: 'fa-plus-circle text-purple-400' }
    ];

    return (
        <>
            <Particles />
            <Toast toast={toast} onDismiss={() => setToast(null)} />
            <HistoryPanel isOpen={isHistoryPanelOpen} onClose={() => setIsHistoryPanelOpen(false)} history={history} onLoad={handleLoadHistory} onDelete={handleDeleteHistory} />

            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', fontFamily: 'Poppins' }}>
                <ImageTemplate ref={imageTemplateRef} data={data} paxTotals={paxTotals} results={results} ejecutivo={ejecutivoGuardia.trim()} isUpdate={isUpdate} imageTheme={imageTheme} reportDate={reportDate} />
            </div>

            {isLoading && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="p-8 rounded-lg shadow-xl flex flex-col items-center" style={{ backgroundColor: 'var(--bg-color-container)' }}>
                        <div className="spinner mb-4"></div>
                        <p className="text-lg font-semibold">Generando imagen...</p>
                    </div>
                </div>
            )}

            <div className="main-container p-8 rounded-2xl shadow-xl w-full max-w-4xl relative">
                <div className="absolute top-4 right-4 flex space-x-2">
                    <button onClick={() => setIsHistoryPanelOpen(true)} className="p-3 rounded-full text-xl hover:opacity-70 transition duration-300 z-10" title="Ver Historial">
                        <i className="fas fa-history"></i>
                    </button>
                    <button onClick={toggleTheme} className="p-3 rounded-full text-xl hover:opacity-70 transition duration-300 z-10" title="Cambiar Tema">
                        <i className={`fas ${uiTheme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
                    </button>
                </div>

                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold mb-2 glow-text">Ocupación Hesperia Playa El Agua</h1>
                    <p className="text-lg" style={{ color: 'var(--text-color-tertiary)' }}>Pronóstico de Ocupación</p>
                </div>

                <div className="space-y-8">
                    <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <StaggeredSection delay={100}>
                            <div className="input-group">
                                <label htmlFor="totalHab" className="block text-sm font-medium mb-1">Total de Habitaciones:</label>
                                <div className="relative">
                                    <input type="number" id="totalHab" value={totalHab} onChange={e => setTotalHab(e.target.value)} className="mt-1 block w-full rounded-lg shadow-sm transition duration-200 p-3 pl-10" min="1" />
                                    <i className="fas fa-hotel absolute left-3 top-3.5" style={{ color: 'var(--text-color-tertiary)' }}></i>
                                </div>
                                {totalHabError && <p className="text-red-400 text-xs mt-1">{totalHabError}</p>}
                            </div>
                        </StaggeredSection>
                        <StaggeredSection delay={200}>
                            <div className="input-group">
                                <label htmlFor="reportDate" className="block text-sm font-medium mb-1">Fecha del Reporte:</label>
                                <div className="relative">
                                    <input type="date" id="reportDate" value={reportDate} onChange={e => setReportDate(e.target.value)} className="mt-1 block w-full rounded-lg shadow-sm transition duration-200 p-3 pl-10" />
                                    <i className="fas fa-calendar-alt absolute left-3 top-3.5" style={{ color: 'var(--text-color-tertiary)' }}></i>
                                </div>
                            </div>
                        </StaggeredSection>
                        <StaggeredSection delay={300}>
                            <div className="input-group">
                                <label htmlFor="ejecutivoGuardia" className="block text-sm font-medium mb-1">Ejecutivo de Guardia:</label>
                                <div className="relative">
                                    <input type="text" id="ejecutivoGuardia" value={ejecutivoGuardia} onChange={e => setEjecutivoGuardia(e.target.value)} className="mt-1 block w-full rounded-lg shadow-sm transition duration-200 p-3 pl-10" placeholder="Nombre" />
                                    <i className="fas fa-user-tie absolute left-3 top-3.5" style={{ color: 'var(--text-color-tertiary)' }}></i>
                                </div>
                            </div>
                        </StaggeredSection>
                    </div>
                    {sections.map((sec, index) => (
                        <StaggeredSection delay={400 + index * 100} key={sec.name}>
                            <OccupancyInputSection title={sec.title} icon={sec.icon} sectionName={sec.name} data={data[sec.name]} paxTotal={paxTotals[sec.name]} onDataChange={handleDataChange} onResetSection={handleResetSection} />
                        </StaggeredSection>
                    ))}
                    <div className="w-full h-px rounded-full my-6" style={{ background: 'linear-gradient(90deg, transparent, var(--text-color-tertiary), transparent)' }}></div>
                    <StaggeredSection delay={800} className="result-box p-6 rounded-2xl shadow-lg">
                        <h2 className="text-2xl font-bold text-center mb-4 flex items-center justify-center"><i className="fas fa-moon mr-2"></i> Cierre del Día (Calculado)</h2>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            {Object.entries({ 'Hab. Ocupadas': results.cierreHab, Adultos: results.cierreAdultos, Niños: results.cierreNinos, Infantes: results.cierreInfantes, 'Total PAX': results.cierrePaxTotal }).map(([label, value]) => (
                                <div key={label} className="text-center p-4 rounded-lg bg-black bg-opacity-20">
                                    <p className="font-medium">{label}</p>
                                    <p className="text-3xl font-extrabold mt-1 gradient-text">{value}</p>
                                </div>
                            ))}
                        </div>
                    </StaggeredSection>
                    <div className="w-full h-px rounded-full my-6" style={{ background: 'linear-gradient(90deg, transparent, var(--text-color-tertiary), transparent)' }}></div>
                    <StaggeredSection delay={900} className="result-box p-6 rounded-2xl shadow-lg floating-card">
                        <h2 className="text-xl font-bold mb-4 flex items-center"><i className="fas fa-chart-pie mr-2 text-pink-400"></i> Porcentaje de Ocupación</h2>
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-lg">Ocupación (%):</span>
                            <span className="text-3xl font-bold gradient-text">{results.occupancyPercentage}</span>
                        </div>
                    </StaggeredSection>
                    <StaggeredSection delay={1000} className="flex items-center justify-between space-x-3 mt-4">
                        <div className="flex items-center space-x-3">
                            <label className="custom-checkbox relative inline-block w-[22px] h-[22px]">
                                <input type="checkbox" id="updateCheckbox" checked={isUpdate} onChange={e => setIsUpdate(e.target.checked)} className="opacity-0 w-0 h-0" />
                                <span className="checkmark absolute top-0 left-0 h-[22px] w-[22px] rounded transition-all"></span>
                            </label>
                            <label htmlFor="updateCheckbox" style={{ color: 'var(--text-color-tertiary)' }}>Marcar como Actualización</label>
                        </div>
                        <button onClick={handleClearForm} className="text-sm font-semibold py-2 px-4 rounded-lg transition-colors duration-200" style={{ color: 'var(--text-color-secondary)', backgroundColor: 'var(--bg-input)' }}><i className="fas fa-trash-alt mr-2"></i> Limpiar Formulario</button>
                    </StaggeredSection>
                    <StaggeredSection delay={1100} className="section-box p-6 rounded-2xl shadow-lg transition-all duration-300 ease-out mt-8">
                        <h2 className="text-xl font-semibold mb-4 flex items-center"><i className="fas fa-palette mr-2" style={{ color: 'var(--primary-color)' }}></i> Selecciona un Modelo de Imagen</h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {(['classic', 'modern', 'aquatic', 'tropical', 'elegant'] as ImageTheme[]).map(theme => (
                                <label key={theme} className="flex flex-col items-center p-3 rounded-lg cursor-pointer transition-all duration-300 border-2" style={{ borderColor: imageTheme === theme ? 'var(--primary-color)' : 'transparent', backgroundColor: imageTheme === theme ? 'rgba(14, 165, 233, 0.1)' : 'transparent' }} onClick={() => setImageTheme(theme)}>
                                    <ThemePreview theme={theme} />
                                    <div className="flex items-center mt-3">
                                        <input type="radio" name="imageTheme" value={theme} checked={imageTheme === theme} onChange={() => { }} className="form-radio" />
                                        <span className="ml-2 capitalize font-medium">{theme}</span>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </StaggeredSection>
                    <StaggeredSection delay={1200} className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                        <button type="button" onClick={handleGenerateAnalysis} disabled={isAnalyzing || !!totalHabError} className="btn-primary glow-button w-full py-4 px-6 rounded-xl font-semibold text-white shadow-lg transition-all duration-300 ease-out flex items-center justify-center relative hover:translate-y-[-3px] hover:shadow-xl active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed">
                            {isAnalyzing ? <span className="spinner spinner-sm mr-2"></span> : <i className="fas fa-brain mr-2"></i>}
                            {isAnalyzing ? 'Analizando...' : 'Analizar con IA'}
                        </button>
                        <button type="button" onClick={handleGenerateImage} disabled={isLoading || !!totalHabError} className="btn-primary glow-button w-full py-4 px-6 rounded-xl font-semibold text-white shadow-lg transition-all duration-300 ease-out flex items-center justify-center relative hover:translate-y-[-3px] hover:shadow-xl active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed">
                            <i className="fas fa-image mr-2"></i>
                            {isLoading ? 'Generando...' : 'Generar Imagen'}
                        </button>
                    </StaggeredSection>
                    {analysis && (
                        <StaggeredSection delay={100}>
                            <div className="ai-analysis-box">
                                <h3 className="text-lg font-semibold mb-2 flex items-center"><i className="fas fa-brain mr-2" style={{ color: 'var(--primary-color)' }}></i> Resumen del Asistente Virtual</h3>
                                <blockquote>{analysis}</blockquote>
                                <button onClick={() => { navigator.clipboard.writeText(analysis); showToast('Análisis copiado', 'success'); }} className="absolute top-4 right-4 text-sm py-1 px-2 rounded-md" style={{ color: 'var(--text-color-secondary)', backgroundColor: 'var(--bg-input)' }} title="Copiar análisis"><i className="fas fa-copy"></i></button>
                            </div>
                        </StaggeredSection>
                    )}
                    {generatedImage && (
                        <StaggeredSection delay={100} className="mt-8">
                            <h2 className="text-xl font-bold text-center mb-4">Tu Imagen está Lista</h2>
                            <div className="relative w-full max-w-sm mx-auto aspect-[9/16] rounded-xl overflow-hidden shadow-lg border" style={{ borderColor: 'var(--border-input)' }}>
                                <img src={generatedImage} alt="Reporte de Ocupación" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex justify-center mt-4 space-x-4">
                                <a href={generatedImage} download={`ocupacion-hotelera-${reportDate}.png`} className="btn-primary py-3 px-6 rounded-xl flex items-center font-semibold text-white shadow-lg transition-all duration-300 ease-out hover:translate-y-[-3px] hover:shadow-xl"><i className="fas fa-download mr-2"></i> Descargar</a>
                            </div>
                        </StaggeredSection>
                    )}
                </div>
            </div>
        </>
    );
};

export default App;