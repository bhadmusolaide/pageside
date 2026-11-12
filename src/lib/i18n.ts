type Dictionary = Record<string, string>;

const EN: Dictionary = {
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
  'tabs.vault': 'Vault',
  'tabs.profiles': 'Profiles',
  'tabs.history': 'History',
  'tabs.settings': 'Settings',
  'panel.title': 'Pageside',
  'panel.detected': 'Detected questions',
  'panel.questions': 'Questions',
  'panel.chat': 'Chat',
  'panel.session': 'Session',
  'panel.vault': 'Vault',
  'panel.auto': 'Auto',
  'panel.scan': 'Scan Page',
  'panel.insertApproved': 'Insert approved',
  'panel.coverLetter': 'Cover Letter',
  'panel.videoScript': 'Video Script',
  'panel.siteProfile': 'Site profile',
  'panel.enablePrompt': 'Pageside uses per-site permissions. Enable it for this site to scan and draft answers.',
  'panel.enable': 'Enable on this site',
  'panel.enabling': 'Enabling…',
  'chat.subtitle': 'Ask about your vault or draft an answer',
  'chat.emptyTitle': 'Chat with your vault',
  'chat.emptyBody': 'Ask a question, or ask me to draft an answer. Replies use your vault and the current page context.',
  'chat.placeholder': 'Ask about your experience, or paste a question…',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.new': 'New chat',
  'chat.sources': 'Sources',
  'chat.you': 'You',
  'chat.assistant': 'Pageside',
  'chat.stopped': 'Stopped',
  'chat.thinking': 'Thinking…',
  'chat.footer': 'Grounded in your vault. Review before using.',
  'chat.error': 'Something went wrong. Try again.',
  'chat.noVault': 'Your vault is empty. Add a resume or notes in Options → Vault for grounded answers.',
  'chat.suggestion1': 'Draft an answer to: Why do you want this job?',
  'chat.suggestion2': 'What are my strongest skills for this role?',
  'chat.suggestion3': 'Summarize my relevant experience.',
  'status.none': 'No draft',
  'status.drafting': 'Drafting…',
  'status.draft': 'Draft',
  'status.inserted': 'Inserted',
  'status.skipped': 'Skipped',
  'status.cancelled': 'Cancelled',
  'status.error': 'Error',
  'source.vault': 'Vault',
  'source.history': 'History',
  'source.llm': 'LLM',
  'action.draft': 'Draft',
  'action.insert': 'Insert this answer',
  'action.regenerate': 'Regenerate',
  'action.skip': 'Skip',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'action.stop': 'Stop',
  'action.undo': 'Undo',
  'action.locate': 'Locate',
  'action.approve': 'Approve for insert',
  'action.approved': 'Approved for insert',
  'action.shorter': 'Shorter',
  'action.longer': 'Longer',
  'action.casual': 'Casual',
  'action.formal': 'Formal',
  'action.retry': 'Retry',
  'action.details': 'Field details',
  'action.hideDetails': 'Hide field details',
  'setup.checking': 'Checking setup…',
  'settings.title': 'Settings',
  'settings.unsaved': 'Unsaved changes',
  'settings.savedMessage': 'Settings saved.',
  'settings.uiLanguage': 'Interface language',
  'settings.uiLanguageHelp': 'Changes the extension UI. Answers use the Language setting below.',
  'settings.provider': 'Provider',
  'settings.apiKey': 'API Key',
  'settings.show': 'Show',
  'settings.hide': 'Hide',
  'settings.clear': 'Clear',
  'settings.model': 'Model',
  'settings.tone': 'Default Tone',
  'settings.maxLength': 'Default Max Length (words)',
  'settings.language': 'Language',
  'settings.languageHelp': 'Language used for generated answers.',
  'settings.retrieval': 'Vault retrieval',
  'settings.contextBudget': 'Vault context budget (tokens)',
  'settings.historyLimit': 'Past answers in context',
  'settings.save': 'Save Settings',
  'settings.saving': 'Saving...',
  'settings.savedButton': 'Saved',
  'settings.testKey': 'Test API Key',
  'settings.testing': 'Testing...',
  'settings.apiKeyNote': 'Stored locally in this Chrome profile. It is not encrypted; anyone with access to this profile can read it.',
  'settings.loading': 'Loading settings...',
  'settings.modelsLoading': 'Loading models…',
  'settings.refreshModels': 'Refresh models',
  'settings.noModelMatches': 'No matching models. You can still type the full model name.',
  'settings.modelHelp': 'Type to search every model available from the selected provider.',
  'settings.modelsCount': '{count} models available',
};

const ES: Dictionary = {
  'theme.light': 'Claro',
  'theme.dark': 'Oscuro',
  'theme.system': 'Sistema',
  'tabs.vault': 'Bóveda',
  'tabs.profiles': 'Perfiles',
  'tabs.history': 'Historial',
  'tabs.settings': 'Ajustes',
  'panel.title': 'Pageside',
  'panel.detected': 'Preguntas detectadas',
  'panel.questions': 'Preguntas',
  'panel.chat': 'Chat',
  'panel.session': 'Sesión',
  'panel.vault': 'Bóveda',
  'panel.auto': 'Auto',
  'panel.scan': 'Escanear página',
  'panel.insertApproved': 'Insertar aprobadas',
  'panel.coverLetter': 'Carta de presentación',
  'panel.videoScript': 'Guion de vídeo',
  'panel.siteProfile': 'Perfil del sitio',
  'panel.enablePrompt': 'Pageside usa permisos por sitio. Actívalo en este sitio para escanear y redactar respuestas.',
  'panel.enable': 'Activar en este sitio',
  'panel.enabling': 'Activando…',
  'chat.subtitle': 'Pregunta sobre tu bóveda o redacta una respuesta',
  'chat.emptyTitle': 'Chatea con tu bóveda',
  'chat.emptyBody': 'Haz una pregunta o pídeme que redacte una respuesta. Las respuestas usan tu bóveda y el contexto de la página actual.',
  'chat.placeholder': 'Pregunta sobre tu experiencia o pega una pregunta…',
  'chat.send': 'Enviar',
  'chat.stop': 'Detener',
  'chat.new': 'Nuevo chat',
  'chat.sources': 'Fuentes',
  'chat.you': 'Tú',
  'chat.assistant': 'Pageside',
  'chat.stopped': 'Detenido',
  'chat.thinking': 'Pensando…',
  'chat.footer': 'Basado en tu bóveda. Revisa antes de usarlo.',
  'chat.error': 'Algo salió mal. Inténtalo de nuevo.',
  'chat.noVault': 'Tu bóveda está vacía. Añade un currículum o notas en Opciones → Bóveda para respuestas fundamentadas.',
  'chat.suggestion1': 'Redacta una respuesta a: ¿Por qué quieres este trabajo?',
  'chat.suggestion2': '¿Cuáles son mis habilidades más fuertes para este puesto?',
  'chat.suggestion3': 'Resume mi experiencia relevante.',
  'status.none': 'Sin borrador',
  'status.drafting': 'Redactando…',
  'status.draft': 'Borrador',
  'status.inserted': 'Insertado',
  'status.skipped': 'Omitido',
  'status.cancelled': 'Cancelado',
  'status.error': 'Error',
  'source.vault': 'Bóveda',
  'source.history': 'Historial',
  'source.llm': 'LLM',
  'action.draft': 'Redactar',
  'action.insert': 'Insertar esta respuesta',
  'action.regenerate': 'Regenerar',
  'action.skip': 'Omitir',
  'action.copy': 'Copiar',
  'action.copied': 'Copiado',
  'action.stop': 'Detener',
  'action.undo': 'Deshacer',
  'action.locate': 'Localizar',
  'action.approve': 'Aprobar para insertar',
  'action.approved': 'Aprobada para insertar',
  'action.shorter': 'Más corta',
  'action.longer': 'Más larga',
  'action.casual': 'Informal',
  'action.formal': 'Formal',
  'action.retry': 'Reintentar',
  'action.details': 'Detalles del campo',
  'action.hideDetails': 'Ocultar detalles',
  'setup.checking': 'Comprobando configuración…',
  'settings.title': 'Ajustes',
  'settings.unsaved': 'Cambios sin guardar',
  'settings.savedMessage': 'Ajustes guardados.',
  'settings.uiLanguage': 'Idioma de la interfaz',
  'settings.uiLanguageHelp': 'Cambia la interfaz de la extensión. Las respuestas usan el ajuste Idioma de abajo.',
  'settings.provider': 'Proveedor',
  'settings.apiKey': 'Clave de API',
  'settings.show': 'Mostrar',
  'settings.hide': 'Ocultar',
  'settings.clear': 'Borrar',
  'settings.model': 'Modelo',
  'settings.tone': 'Tono predeterminado',
  'settings.maxLength': 'Longitud máxima (palabras)',
  'settings.language': 'Idioma',
  'settings.languageHelp': 'Idioma usado para las respuestas generadas.',
  'settings.retrieval': 'Recuperación de la bóveda',
  'settings.contextBudget': 'Presupuesto de contexto (tokens)',
  'settings.historyLimit': 'Respuestas anteriores en contexto',
  'settings.save': 'Guardar ajustes',
  'settings.saving': 'Guardando...',
  'settings.savedButton': 'Guardado',
  'settings.testKey': 'Probar clave de API',
  'settings.testing': 'Probando...',
  'settings.apiKeyNote': 'Se guarda localmente en este perfil de Chrome. No está cifrada; cualquiera con acceso a este perfil puede leerla.',
  'settings.loading': 'Cargando ajustes...',
  'settings.modelsLoading': 'Cargando modelos…',
  'settings.refreshModels': 'Actualizar modelos',
  'settings.noModelMatches': 'No hay modelos coincidentes. Puedes escribir el nombre completo del modelo.',
  'settings.modelHelp': 'Escribe para buscar entre todos los modelos disponibles del proveedor seleccionado.',
  'settings.modelsCount': '{count} modelos disponibles',
};

const DICTIONARIES: Record<string, Dictionary> = { en: EN, es: ES };
const listeners = new Set<() => void>();
let locale = 'en';

export function supportedLocales(): string[] {
  return Object.keys(DICTIONARIES);
}

export function setUiLocale(value: string): void {
  locale = DICTIONARIES[value] ? value : 'en';
  try {
    document.documentElement.lang = locale;
  } catch {
    /* no document (tests) */
  }
  listeners.forEach(listener => listener());
}

export function getUiLocale(): string {
  return locale;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: string): string {
  return DICTIONARIES[locale]?.[key] ?? EN[key] ?? key;
}

export async function initI18n(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get({ uiLanguage: '', language: 'en' });
    const initial = String(stored.uiLanguage || stored.language || 'en');
    setUiLocale(initial);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.uiLanguage) {
        setUiLocale(String(changes.uiLanguage.newValue || 'en'));
      } else if (changes.language && !changes.uiLanguage) {
        chrome.storage.local.get({ uiLanguage: '' })
          .then(current => {
            if (!current.uiLanguage) setUiLocale(String(changes.language.newValue || 'en'));
          })
          .catch(() => {});
      }
    });
  } catch {
    setUiLocale('en');
  }
}
