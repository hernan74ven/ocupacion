import React, { useState, useEffect, useMemo, useRef, useCallback, forwardRef } from 'react';
import type { OccupancySectionData, SectionName, ImageTheme, UiTheme, CalculatedResults, ToastState, HistoricalReport } from './types';
import { GoogleGenAI } from '@google/genai';

// @ts-ignore
import html2canvas from 'html2canvas';

// --- API Key Error Component ---
const ApiKeyError: React.FC = () => (
    <div className="flex items-center justify-center min-h-screen p-4 text-center">
        <div className="main-container max-w-2xl p-8 rounded-2xl shadow-xl relative">
             <div className="text-center mb-8">
                 <i className="fas fa-exclamation-triangle text-5xl text-yellow-400 mb-4"></i>
                <h1 className="text-3xl font-bold mb-4">Configuración Requerida</h1>
                <p className="text-lg mb-6" style={{ color: 'var(--text-color-secondary)' }}>
                    No se ha encontrado tu clave de API de Gemini. Para continuar, sigue estos pasos:
                </p>
                <div className="text-left p-6 rounded-lg font-mono text-sm" style={{backgroundColor: 'var(--bg-input)'}}>
                    <p className="mb-2">1. Crea un archivo llamado <code className="font-bold p-1 rounded" style={{backgroundColor: 'rgba(0,0,0,0.2)'}}>.env.local</code> en la carpeta principal del proyecto.</p>
                    <p className="mt-4">2. Agrega la siguiente línea a ese archivo, reemplazando <code className="font-bold p-1 rounded" style={{backgroundColor: 'rgba(0,0,0,0.2)'}}>TU_API_KEY</code> con tu clave real:</p>
                    <code className="block bg-black text-green-300 p-3 rounded mt-2 text-md">GEMINI_API_KEY="TU_API_KEY"</code>
                    <p className="mt-4">3. Guarda el archivo y <strong className="font-bold text-yellow-400">reinicia el servidor de desarrollo</strong>.</p>
                </div>
                 <p className="text-sm mt-6" style={{ color: 'var(--text-color-tertiary)' }}>
                    Si no tienes una clave, puedes obtener una en Google AI Studio.
                </p>
            </div>
        </div>
    </div>
);


// --- IndexedDB Database Helpers ---

const DB_NAME = 'HotelOccupancyDB';
const STORE_NAME = 'appState';
const HISTORICAL_STORE_NAME = 'historicalReports';
const DB_VERSION = 2; // Incremented version for schema change
const STATE_KEY = 'currentFormState';

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB error:', request.error);
            reject(new Error('Error opening IndexedDB.'));
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(HISTORICAL_STORE_NAME)) {
                db.createObjectStore(HISTORICAL_STORE_NAME, { keyPath: 'id' });
            }
        };
    });
};

async function getFromDB<T>(key: IDBValidKey): Promise<T | undefined> {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(new Error('Error reading from DB.'));
        request.onsuccess = () => resolve(request.result as T | undefined);
    });
}

const saveToDB = async (key: IDBValidKey, value: any): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(value, key);
    
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(new Error('Error writing to DB.'));
        request.onsuccess = () => resolve();
    });
};

const deleteFromDB = async (key: IDBValidKey): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    return new Promise((resolve, reject) => {
        request.onerror = () => reject(new Error('Error deleting from DB.'));
        request.onsuccess = () => resolve();
    });
};

// --- Historical Reports DB Helpers ---

const saveReportToDB = async (report: HistoricalReport): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(HISTORICAL_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(HISTORICAL_STORE_NAME);
    const request = store.put(report);
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(new Error('Error saving historical report.'));
        request.onsuccess = () => resolve();
    });
};

const getAllReportsFromDB = async (): Promise<HistoricalReport[]> => {
    const db = await openDB();
    const transaction = db.transaction(HISTORICAL_STORE_NAME, 'readonly');
    const store = transaction.objectStore(HISTORICAL_STORE_NAME);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(new Error('Error fetching historical reports.'));
        request.onsuccess = () => {
            const reports: HistoricalReport[] = request.result;
            reports.sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime());
            resolve(reports);
        };
    });
};

const deleteReportFromDB = async (reportId: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(HISTORICAL_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(HISTORICAL_STORE_NAME);
    const request = store.delete(reportId);
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(new Error('Error deleting historical report.'));
        request.onsuccess = () => resolve();
    });
};


// --- HELPER COMPONENTS ---

const StaggeredSection: React.FC<{ children: React.ReactNode, delay: number, className?: string }> = ({ children, delay, className = '' }) => {
    const [isAnimated, setIsAnimated] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setIsAnimated(true), delay);
        return () => clearTimeout(timer);
    }, [delay]);

    return (
        <div className={`stagger-animation ${isAnimated ? 'animate' : ''} ${className}`}>
            {children}
        </div>
    );
};

const Particles: React.FC = () => {
    useEffect(() => {
        const container = document.getElementById('particles-container');
        if (!container) return;
        if (container.childElementCount > 0) return;

        const particleCount = 30;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            const size = Math.random() * 10 + 5;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 100}%`;
            const duration = Math.random() * 20 + 10;
            particle.style.animationDuration = `${duration}s`;
            const delay = Math.random() * 5;
            particle.style.animationDelay = `${delay}s`;
            fragment.appendChild(particle);
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

    const iconClass = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    }[toast.type];

    return (
        <div className={`toast p-4 rounded-lg shadow-lg flex items-center ${toast ? 'show' : ''} ${toast.type}`}>
            <i className={`fas ${iconClass} toast-icon mr-3 text-2xl`}></i>
            <span>{toast.message}</span>
        </div>
    );
};

interface OccupancyInputSectionProps {
    title: string;
    icon: string;
    data: OccupancySectionData;
    errors: OccupancySectionData;
    paxTotal: number;
    sectionName: SectionName;
    onDataChange: (section: SectionName, field: keyof OccupancySectionData, value: string) => void;
    onResetSection: (section: SectionName) => void;
}

const OccupancyInputSection: React.FC<OccupancyInputSectionProps> = ({ title, icon, data, errors, paxTotal, sectionName, onDataChange, onResetSection }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        onDataChange(sectionName, name as keyof OccupancySectionData, value);
    };

    return (
        <div className="section-box p-6 rounded-2xl shadow-lg transition-all duration-300 ease-out">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold flex items-center">
                    <i className={`fas ${icon} mr-2`}></i> {title}
                </h2>
                <button 
                    onClick={() => onResetSection(sectionName)} 
                    className="text-sm transition-colors duration-200 hover:text-white"
                    style={{ color: 'var(--text-color-tertiary)' }}
                    title={`Reiniciar sección ${title}`}
                    aria-label={`Reiniciar sección ${title}`}
                >
                    <i className="fas fa-undo"></i>
                </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-start">
                {(Object.keys(data) as Array<keyof OccupancySectionData>).map((key) => (
                    <div className="input-group" key={key}>
                        <label htmlFor={`${sectionName}${key}`} className="block text-sm font-medium capitalize" style={{ color: 'var(--text-color-secondary)' }}>
                            {key === 'hab' ? 'Habitaciones' : key}
                        </label>
                        <input
                            type="number"
                            id={`${sectionName}${key}`}
                            name={key}
                            value={data[key]}
                            onChange={handleChange}
                            min="0"
                            className={`mt-1 block w-full rounded-lg p-3 transition-all duration-300 ease-out ${errors[key] ? 'invalid' : ''}`}
                        />
                         {errors[key] && <p className="text-red-400 text-xs mt-1">{errors[key]}</p>}
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

interface ImageTemplateProps {
    data: Record<SectionName, OccupancySectionData>;
    paxTotals: Record<SectionName, number>;
    results: CalculatedResults;
    ejecutivo: string;
    isUpdate: boolean;
    imageTheme: ImageTheme;
    reportDate: string;
}

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
                        <p className="text-5xl font-bold text-center" style={{ color: 'var(--image-section)' }}>
                            Ocupación: <span className="font-extrabold" style={{ color: 'var(--image-highlight)' }}>{results.occupancyPercentage}</span>
                        </p>
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
        <div className={`w-full h-24 rounded-lg p-2 shadow-inner flex flex-col justify-between ${themeClass} transition-all duration-300`}>
            <div className="flex items-center justify-between">
                <div className="w-1/3 h-2 rounded-full" style={{ backgroundColor: 'var(--image-text)' }}></div>
                <div className="w-1/4 h-2 rounded-full opacity-70" style={{ backgroundColor: 'var(--image-section)' }}></div>
            </div>
            <div className="flex-grow my-2 p-2 rounded" style={{ backgroundColor: 'var(--image-card-bg)' }}>
                <div className="w-3/4 h-1.5 rounded-full mb-1.5" style={{ backgroundColor: 'var(--image-text)' }}></div>
                <div className="w-1/2 h-1.5 rounded-full opacity-70" style={{ backgroundColor: 'var(--image-text)' }}></div>
            </div>
            <div className="h-2.5 rounded-sm" style={{ background: 'var(--image-highlight)' }}></div>
        </div>
    );
};

interface HistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    reports: HistoricalReport[];
    onLoad: (report: HistoricalReport) => void;
    onDelete: (reportId: string) => void;
}

const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose, reports, onLoad, onDelete }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 modal-overlay" onClick={onClose}>
            <div className="modal-content w-full max-w-2xl rounded-2xl shadow-xl p-6 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Historial de Reportes</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:opacity-70 transition-opacity">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>
                <div className="overflow-y-auto pr-2 space-y-4">
                    {reports.length === 0 ? (
                        <div className="text-center py-10">
                            <p style={{ color: 'var(--text-color-tertiary)' }}>No hay reportes guardados.</p>
                        </div>
                    ) : (
                        reports.map(report => (
                            <div key={report.id} className="history-item flex flex-col md:flex-row justify-between items-start md:items-center p-4 rounded-lg">
                                <div className="mb-3 md:mb-0">
                                    <p className="font-bold text-lg">{new Date(`${report.reportDate}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                                    <p className="text-sm" style={{ color: 'var(--text-color-secondary)' }}>
                                        Ocupación: <span className="font-semibold" style={{ color: 'var(--text-color-primary)' }}>{report.results.occupancyPercentage}</span> |
                                        PAX: <span className="font-semibold" style={{ color: 'var(--text-color-primary)' }}>{report.results.cierrePaxTotal}</span> |
                                        Ejecutivo: <span className="font-semibold" style={{ color: 'var(--text-color-primary)' }}>{report.ejecutivoGuardia || 'N/A'}</span>
                                    </p>
                                </div>
                                <div className="flex space-x-2">
                                    <button onClick={() => onLoad(report)} className="history-btn-load py-2 px-4 text-sm rounded-lg font-semibold flex items-center"><i className="fas fa-upload mr-2"></i>Cargar</button>
                                    <button onClick={() => onDelete(report.id)} className="history-btn-delete py-2 px-4 text-sm rounded-lg font-semibold flex items-center"><i className="fas fa-trash-alt mr-2"></i>Eliminar</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};


// --- CONSTANTS & INITIAL STATE ---

const emptyData = { hab: '', adultos: '', ninos: '', infantes: '' };
const emptySectionErrors = { amanecimos: emptyData, entradas: emptyData, salidas: emptyData, usoCasa: emptyData, complementarias: emptyData };

const initialState = {
    totalHab: '148',
    ejecutivoGuardia: '',
    reportDate: new Date().toISOString().split('T')[0],
    data: {
        amanecimos: { hab: '0', adultos: '0', ninos: '0', infantes: '0' },
        entradas: { hab: '0', adultos: '0', ninos: '0', infantes: '0' },
        salidas: { hab: '0', adultos: '0', ninos: '0', infantes: '0' },
        usoCasa: { hab: '0', adultos: '0', ninos: '0', infantes: '0' },
        complementarias: { hab: '0', adultos: '0', ninos: '0', infantes: '0' },
    }
};

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
    const [errors, setErrors] = useState({ totalHab: '', data: emptySectionErrors });
    const [isThemeSelectorOpen, setIsThemeSelectorOpen] = useState(true);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [historicalReports, setHistoricalReports] = useState<HistoricalReport[]>([]);

    const imageTemplateRef = useRef<HTMLDivElement>(null);
    
    const apiKey = process.env.API_KEY;

    const ai = useMemo(() => {
        if (!apiKey) {
            console.error("GEMINI_API_KEY not found. Please set it in your .env.local file.");
            return null;
        }
        try {
            return new GoogleGenAI({ apiKey });
        } catch (error) {
            console.error("Error initializing GoogleGenAI:", error);
            return null;
        }
    }, [apiKey]);

    const showToast = useCallback((message: string, type: ToastState['type']) => {
        setToast({ message, type });
    }, []);

    const loadHistoricalReports = useCallback(async () => {
        try {
            const reports = await getAllReportsFromDB();
            setHistoricalReports(reports);
        } catch (error) {
            console.error("Failed to load historical reports", error);
            showToast('Error al cargar el historial de reportes.', 'error');
        }
    }, [showToast]);
    
    // Load data from IndexedDB on initial mount
    useEffect(() => {
        const loadInitialState = async () => {
            try {
                const savedState = await getFromDB<any>(STATE_KEY);
                if (savedState) {
                    setTotalHab(savedState.totalHab || initialState.totalHab);
                    setEjecutivoGuardia(savedState.ejecutivoGuardia || initialState.ejecutivoGuardia);
                    setData(savedState.data || initialState.data);
                    setReportDate(savedState.reportDate || initialState.reportDate);
                }
            } catch (error) {
                console.error("Failed to load data from IndexedDB", error);
                showToast('No se pudieron cargar los datos guardados.', 'error');
            }
        };

        loadInitialState();
        loadHistoricalReports();
        const savedTheme = localStorage.getItem('theme') as UiTheme || 'dark';
        setUiTheme(savedTheme);
    }, [showToast, loadHistoricalReports]);

    // Debounced save to IndexedDB
    useEffect(() => {
        const stateToSave = { totalHab, ejecutivoGuardia, data, reportDate };
        
        const handler = setTimeout(async () => {
            try {
                await saveToDB(STATE_KEY, stateToSave);
            } catch (error) {
                console.error("Failed to save data to IndexedDB", error);
            }
        }, 500); // Debounce saves by 500ms

        return () => clearTimeout(handler);
    }, [totalHab, ejecutivoGuardia, data, reportDate]);

    useEffect(() => {
        document.body.classList.toggle('light-mode', uiTheme === 'light');
        localStorage.setItem('theme', uiTheme);
    }, [uiTheme]);
    
    // Real-time validation
    useEffect(() => {
        const newErrors = { totalHab: '', data: { ...emptySectionErrors } };

        const totalHabNum = Number(totalHab);
        if (isNaN(totalHabNum) || totalHab.trim() === '') newErrors.totalHab = 'Debe ser un número.';
        else if (!Number.isInteger(totalHabNum)) newErrors.totalHab = 'Debe ser un número entero.';
        else if (totalHabNum <= 0) newErrors.totalHab = 'Debe ser mayor que 0.';

        for (const sectionName in data) {
            for (const field in data[sectionName as SectionName]) {
                const value = data[sectionName as SectionName][field as keyof OccupancySectionData];
                const numValue = Number(value);

                if (value.trim() === '') newErrors.data[sectionName as SectionName][field as keyof OccupancySectionData] = 'Requerido.';
                else if (isNaN(numValue)) newErrors.data[sectionName as SectionName][field as keyof OccupancySectionData] = 'Inválido.';
                else if (!Number.isInteger(numValue)) newErrors.data[sectionName as SectionName][field as keyof OccupancySectionData] = 'Debe ser entero.';
                else if (numValue < 0) newErrors.data[sectionName as SectionName][field as keyof OccupancySectionData] = 'No negativo.';
            }
        }
        
        const amanecimos = (Object.fromEntries(Object.entries(data.amanecimos).map(([k, v]) => [k, Number(v)])) as any);
        const salidas = (Object.fromEntries(Object.entries(data.salidas).map(([k, v]) => [k, Number(v)])) as any);

        if (salidas.hab > amanecimos.hab && !newErrors.data.salidas.hab) newErrors.data.salidas.hab = 'No puede exceder amanecidas.';
        if (salidas.adultos > amanecimos.adultos && !newErrors.data.salidas.adultos) newErrors.data.salidas.adultos = 'No puede exceder amanecidos.';
        if (salidas.ninos > amanecimos.ninos && !newErrors.data.salidas.ninos) newErrors.data.salidas.ninos = 'No puede exceder amanecidos.';
        if (salidas.infantes > amanecimos.infantes && !newErrors.data.salidas.infantes) newErrors.data.salidas.infantes = 'No puede exceder amanecidos.';

        setErrors(newErrors);
    }, [data, totalHab]);

    const isFormInvalid = useMemo(() => {
        if (errors.totalHab) return true;
        return Object.values(errors.data).some(section => Object.values(section).some(err => err));
    }, [errors]);


    const handleDataChange = useCallback((section: SectionName, field: keyof OccupancySectionData, value: string) => {
        setData(prevData => ({
            ...prevData,
            [section]: { ...prevData[section], [field]: value }
        }));
    }, []);
    
    const handleResetSection = useCallback((sectionName: SectionName) => {
        setData(prevData => ({
            ...prevData,
            [sectionName]: { hab: '0', adultos: '0', ninos: '0', infantes: '0' }
        }));
        showToast(`Sección ${sectionName} reiniciada`, 'info');
    }, [showToast]);

    const handleClearForm = async () => {
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
    };

    const paxTotals = useMemo(() => {
        return (Object.keys(data) as SectionName[]).reduce((acc, section) => {
            const { adultos, ninos, infantes } = data[section];
            acc[section] = (parseInt(adultos) || 0) + (parseInt(ninos) || 0) + (parseInt(infantes) || 0);
            return acc;
        }, {} as Record<SectionName, number>);
    }, [data]);

    const results = useMemo<CalculatedResults>(() => {
        if (isFormInvalid) {
            return { cierreHab: 0, cierreAdultos: 0, cierreNinos: 0, cierreInfantes: 0, cierrePaxTotal: 0, occupancyPercentage: '0.00%' };
        }
        const d = (Object.keys(data) as SectionName[]).reduce((acc, section) => {
            acc[section] = Object.fromEntries(Object.entries(data[section]).map(([k, v]) => [k, parseInt(v) || 0])) as { [key in keyof OccupancySectionData]: number };
            return acc;
        }, {} as Record<SectionName, { [key in keyof OccupancySectionData]: number }>);

        const cierreHab = d.amanecimos.hab - d.salidas.hab + d.entradas.hab + d.usoCasa.hab + d.complementarias.hab;
        const cierreAdultos = d.amanecimos.adultos - d.salidas.adultos + d.entradas.adultos + d.usoCasa.adultos + d.complementarias.adultos;
        const cierreNinos = d.amanecimos.ninos - d.salidas.ninos + d.entradas.ninos + d.usoCasa.ninos + d.complementarias.ninos;
        const cierreInfantes = d.amanecimos.infantes - d.salidas.infantes + d.entradas.infantes + d.usoCasa.infantes + d.complementarias.infantes;
        const cierrePaxTotal = cierreAdultos + cierreNinos + cierreInfantes;

        const totalHabNum = parseInt(totalHab) || 1;
        const occupancy = (cierreHab / totalHabNum) * 100;
        
        return {
            cierreHab,
            cierreAdultos,
            cierreNinos,
            cierreInfantes,
            cierrePaxTotal,
            occupancyPercentage: `${occupancy.toFixed(2)}%`,
        };
    }, [data, totalHab, isFormInvalid]);

    const toggleTheme = () => {
        setUiTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
        showToast(`Tema ${uiTheme === 'dark' ? 'claro' : 'oscuro'} activado`, 'info');
    };
    
    const handleGenerateAnalysis = async () => {
        if (!ai) {
            showToast('Cliente de IA no inicializado. Verifica tu API Key.', 'error');
            return;
        }
        setIsAnalyzing(true);
        setAnalysis('');
        showToast('La IA está analizando los datos...', 'info');
        
        const prompt = `Eres un asistente virtual para gerentes del Hotel Hesperia Playa El Agua. Tu tono es profesional, conciso y motivador. No uses markdown. Analiza los siguientes datos de ocupación del día y genera un breve resumen de 2 a 3 frases para compartir con el equipo directivo.

Datos del día:
- Fecha: ${new Date(reportDate + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Ocupación: ${results.occupancyPercentage}
- Habitaciones Ocupadas: ${results.cierreHab} de ${totalHab}
- Huéspedes Totales: ${results.cierrePaxTotal}
- Entradas: ${data.entradas.hab} habitaciones, ${paxTotals.entradas} huéspedes.
- Salidas: ${data.salidas.hab} habitaciones, ${paxTotals.salidas} huéspedes.

Enfócate en los puntos clave y finaliza con una nota positiva.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            setAnalysis(response.text);
            showToast('Análisis generado con éxito', 'success');
        } catch (error) {
            console.error('Error generating analysis:', error);
            showToast('Error al contactar la IA. Inténtalo de nuevo.', 'error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleGenerateImage = async () => {
        if (!imageTemplateRef.current) {
            showToast('Error: No se pudo encontrar la plantilla de imagen.', 'error');
            return;
        }
        setIsLoading(true);
        setGeneratedImage(null);
        
        try {
            await new Promise(resolve => setTimeout(resolve, 100)); 
            
            const canvas = await html2canvas(imageTemplateRef.current, { 
                scale: 1,
                backgroundColor: null,
                useCORS: true,
            });
            const imageURL = canvas.toDataURL('image/png');
            setGeneratedImage(imageURL);
            showToast('Imagen generada con éxito', 'success');
        } catch (error) {
            console.error('Error generating image:', error);
            showToast('Ocurrió un error al generar la imagen', 'error');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleSaveReport = async () => {
        if (historicalReports.some(r => r.id === reportDate)) {
            if (!window.confirm('Ya existe un reporte para esta fecha. ¿Desea sobrescribirlo?')) {
                return;
            }
        }

        const report: HistoricalReport = {
            id: reportDate,
            reportDate,
            totalHab,
            ejecutivoGuardia,
            data,
            analysis,
            results,
            createdAt: Date.now()
        };

        try {
            await saveReportToDB(report);
            await loadHistoricalReports();
            showToast('Reporte guardado en el historial.', 'success');
        } catch (error) {
            console.error("Failed to save report", error);
            showToast('Error al guardar el reporte.', 'error');
        }
    };

    const handleLoadReport = (report: HistoricalReport) => {
        setTotalHab(report.totalHab);
        setReportDate(report.reportDate);
        setEjecutivoGuardia(report.ejecutivoGuardia);
        setData(report.data);
        setAnalysis(report.analysis);
        setIsHistoryModalOpen(false);
        showToast(`Reporte del ${report.reportDate} cargado.`, 'info');
    };

    const handleDeleteReport = async (reportId: string) => {
        const reportDateFormatted = new Date(`${reportId}T00:00:00`).toLocaleDateString('es-ES');
        if (window.confirm(`¿Está seguro de que desea eliminar el reporte del ${reportDateFormatted}?`)) {
            try {
                await deleteReportFromDB(reportId);
                await loadHistoricalReports();
                showToast('Reporte eliminado.', 'success');
            } catch (error) {
                console.error("Failed to delete report", error);
                showToast('Error al eliminar el reporte.', 'error');
            }
        }
    };


    if (!ai) {
        return <ApiKeyError />;
    }


    const sections: { name: SectionName, title: string, icon: string }[] = [
        { name: 'amanecimos', title: 'Amanecimos', icon: 'fa-sun text-yellow-400' },
        { name: 'entradas', title: 'Entradas', icon: 'fa-sign-in-alt text-green-400' },
        { name: 'salidas', title: 'Salidas', icon: 'fa-sign-out-alt text-red-400' },
        { name: 'usoCasa', title: 'Uso Casa', icon: 'fa-home text-blue-400' },
        { name: 'complementarias', title: 'Complementarias', icon: 'fa-plus-circle text-purple-400' },
    ];

    return (
        <>
            <Particles />
            <Toast toast={toast} onDismiss={() => setToast(null)} />
            <HistoryModal 
                isOpen={isHistoryModalOpen}
                onClose={() => setIsHistoryModalOpen(false)}
                reports={historicalReports}
                onLoad={handleLoadReport}
                onDelete={handleDeleteReport}
            />
            
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', fontFamily: 'Poppins' }}>
                <ImageTemplate 
                    ref={imageTemplateRef} 
                    data={data} 
                    paxTotals={paxTotals}
                    results={results}
                    ejecutivo={ejecutivoGuardia.trim()}
                    isUpdate={isUpdate}
                    imageTheme={imageTheme}
                    reportDate={reportDate}
                />
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
                <div className="absolute top-4 right-4 flex space-x-2 z-10">
                    <button onClick={() => setIsHistoryModalOpen(true)} title="Ver Historial" className="p-3 rounded-full text-xl hover:opacity-70 transition duration-300">
                        <i className="fas fa-history"></i>
                    </button>
                     <button onClick={toggleTheme} title="Cambiar Tema" className="p-3 rounded-full text-xl hover:opacity-70 transition duration-300">
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
                                    <input type="number" id="totalHab" value={totalHab} onChange={e => setTotalHab(e.target.value)} className={`mt-1 block w-full rounded-lg p-3 pl-10 ${errors.totalHab ? 'invalid' : ''}`} min="1" />
                                    <i className="fas fa-hotel absolute left-3 top-3.5" style={{ color: 'var(--text-color-tertiary)' }}></i>
                                </div>
                                {errors.totalHab && <p className="text-red-400 text-xs mt-1">{errors.totalHab}</p>}
                           </div>
                        </StaggeredSection>
                         <StaggeredSection delay={200}>
                            <div className="input-group">
                                <label htmlFor="reportDate" className="block text-sm font-medium mb-1">Fecha del Reporte:</label>
                                 <div className="relative">
                                    <input type="date" id="reportDate" value={reportDate} onChange={e => setReportDate(e.target.value)} className="mt-1 block w-full rounded-lg p-3 pl-10" />
                                    <i className="fas fa-calendar-alt absolute left-3 top-3.5" style={{ color: 'var(--text-color-tertiary)' }}></i>
                                </div>
                            </div>
                        </StaggeredSection>
                        <StaggeredSection delay={300}>
                            <div className="input-group">
                                <label htmlFor="ejecutivoGuardia" className="block text-sm font-medium mb-1">Ejecutivo de Guardia:</label>
                                 <div className="relative">
                                    <input type="text" id="ejecutivoGuardia" value={ejecutivoGuardia} onChange={e => setEjecutivoGuardia(e.target.value)} className="mt-1 block w-full rounded-lg p-3 pl-10" placeholder="Nombre" />
                                    <i className="fas fa-user-tie absolute left-3 top-3.5" style={{ color: 'var(--text-color-tertiary)' }}></i>
                                </div>
                            </div>
                        </StaggeredSection>
                    </div>
                    
                    {sections.map((sec, index) => (
                        <StaggeredSection delay={400 + index * 100} key={sec.name}>
                            <OccupancyInputSection 
                                title={sec.title}
                                icon={sec.icon}
                                sectionName={sec.name}
                                data={data[sec.name]}
                                errors={errors.data[sec.name]}
                                paxTotal={paxTotals[sec.name]}
                                onDataChange={handleDataChange}
                                onResetSection={handleResetSection}
                            />
                        </StaggeredSection>
                    ))}

                    <div className="w-full h-px rounded-full my-6" style={{ background: 'linear-gradient(90deg, transparent, var(--text-color-tertiary), transparent)' }}></div>

                    <StaggeredSection delay={800} className="result-box p-6 rounded-2xl shadow-lg">
                        <h2 className="text-2xl font-bold text-center mb-4 flex items-center justify-center">
                            <i className="fas fa-moon mr-2"></i> Cierre del Día (Calculado)
                        </h2>
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
                         <h2 className="text-xl font-bold mb-4 flex items-center">
                            <i className="fas fa-chart-pie mr-2 text-pink-400"></i> Porcentaje de Ocupación
                        </h2>
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
                        <button 
                            onClick={handleClearForm} 
                            className="text-sm font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
                            style={{ color: 'var(--text-color-secondary)', backgroundColor: 'var(--bg-input)' }}
                        >
                            <i className="fas fa-trash-alt mr-2"></i> Limpiar Formulario
                        </button>
                    </StaggeredSection>

                    <StaggeredSection delay={1100} className="section-box p-6 rounded-2xl shadow-lg transition-all duration-300 ease-out mt-8">
                        <div 
                            className="flex justify-between items-center cursor-pointer"
                            onClick={() => setIsThemeSelectorOpen(!isThemeSelectorOpen)}
                            aria-expanded={isThemeSelectorOpen}
                            aria-controls="theme-selector-content"
                        >
                            <h2 className="text-xl font-semibold flex items-center">
                                <i className="fas fa-palette mr-2" style={{ color: 'var(--primary-color)' }}></i> Selecciona un Modelo de Imagen
                            </h2>
                            <i className={`fas fa-chevron-down transition-transform duration-300 ${isThemeSelectorOpen ? 'rotate-180' : ''}`}></i>
                        </div>
                        
                        <div
                            id="theme-selector-content"
                            className={`transition-all ease-in-out duration-500 overflow-hidden ${isThemeSelectorOpen ? 'max-h-screen mt-4' : 'max-h-0 mt-0'}`}
                        >
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {(['classic', 'modern', 'aquatic', 'tropical', 'elegant'] as ImageTheme[]).map(theme => (
                                    <label
                                        key={theme}
                                        className={`theme-selector-label flex flex-col items-center p-2 rounded-xl cursor-pointer transition-all duration-300 border-2 ${
                                            imageTheme === theme ? 'theme-selected' : 'theme-unselected'
                                        }`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setImageTheme(theme);
                                        }}
                                    >
                                        <ThemePreview theme={theme} />
                                        <span className="mt-2 capitalize font-medium text-sm">{theme}</span>
                                        <input
                                            type="radio"
                                            name="imageTheme"
                                            value={theme}
                                            checked={imageTheme === theme}
                                            onChange={() => {}}
                                            className="sr-only"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    </StaggeredSection>

                    <StaggeredSection delay={1200} className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                         <button type="button" onClick={handleSaveReport} disabled={isFormInvalid} className="btn-secondary glow-button w-full py-4 px-6 rounded-xl font-semibold text-white shadow-lg transition-all duration-300 ease-out flex items-center justify-center relative hover:translate-y-[-3px] hover:shadow-xl active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed">
                             <i className="fas fa-save mr-2"></i> Guardar Reporte
                         </button>
                         <button type="button" onClick={handleGenerateAnalysis} disabled={isAnalyzing || isFormInvalid} className="btn-primary glow-button w-full py-4 px-6 rounded-xl font-semibold text-white shadow-lg transition-all duration-300 ease-out flex items-center justify-center relative hover:translate-y-[-3px] hover:shadow-xl active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed">
                            {isAnalyzing ? <span className="spinner spinner-sm mr-2"></span> : <i className="fas fa-brain mr-2"></i> }
                            {isAnalyzing ? 'Analizando...' : 'Analizar con IA'}
                        </button>
                         <button type="button" onClick={handleGenerateImage} disabled={isLoading || isFormInvalid} className="btn-primary glow-button w-full py-4 px-6 rounded-xl font-semibold text-white shadow-lg transition-all duration-300 ease-out flex items-center justify-center relative hover:translate-y-[-3px] hover:shadow-xl active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed">
                            <i className="fas fa-image mr-2"></i> 
                            {isLoading ? 'Generando...' : 'Generar Imagen'}
                        </button>
                    </StaggeredSection>

                     {analysis && (
                        <StaggeredSection delay={100}>
                             <div className="ai-analysis-box">
                                <h3 className="text-lg font-semibold mb-2 flex items-center"><i className="fas fa-brain mr-2" style={{ color: 'var(--primary-color)' }}></i> Resumen del Asistente Virtual</h3>
                                <blockquote>{analysis}</blockquote>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(analysis);
                                        showToast('Análisis copiado al portapapeles', 'success');
                                    }}
                                    className="absolute top-4 right-4 text-sm py-1 px-2 rounded-md"
                                    style={{ color: 'var(--text-color-secondary)', backgroundColor: 'var(--bg-input)' }}
                                    title="Copiar análisis"
                                >
                                    <i className="fas fa-copy"></i>
                                </button>
                            </div>
                        </StaggeredSection>
                    )}

                    {generatedImage && (
                        <StaggeredSection delay={100} className="mt-8">
                            <h2 className="text-xl font-bold text-center mb-4">Tu Imagen está Lista</h2>
                            <div className="relative w-full max-w-sm mx-auto aspect-[9/16] rounded-xl overflow-hidden shadow-lg border" style={{ borderColor: 'var(--border-input)'}}>
                                <img src={generatedImage} alt="Generated Occupancy Report" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex justify-center mt-4 space-x-4">
                                <a href={generatedImage} download={`ocupacion-hotelera-${reportDate}.png`} className="btn-primary py-3 px-6 rounded-xl flex items-center font-semibold text-white shadow-lg transition-all duration-300 ease-out hover:translate-y-[-3px] hover:shadow-xl">
                                    <i className="fas fa-download mr-2"></i> Descargar
                                </a>
                            </div>
                        </StaggeredSection>
                    )}
                </div>
            </div>
        </>
    );
};

export default App;