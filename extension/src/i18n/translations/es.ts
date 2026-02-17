import { Translations } from '../types';

export const es: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    myColor: 'Mi color',
    turn: 'Turno',
    white: 'Blancas',
    black: 'Negras',
    lastGamePlayed: 'Última Partida Jugada',
  },

  analysis: {
    eval: 'Eval',
    centipawns: 'Centipeones',
    move: 'Jugada',
    mateIn: 'Mate en',
    reanalyze: 'Re-analizar',
  },

  elo: {
    title: 'ELO Objetivo',
    display: 'Visualización Chess.com',
    antiCheat: 'Aleatorización ELO ±100',
    fullStrength: 'Modo Fuerza Completa',
    fullStrengthDesc: 'Desactivar límite ELO para sugerencias de máxima fuerza (disponible a partir de 2000 ELO)',
  },

  personalities: {
    title: 'Personalidad',
    Default: {
      label: 'Predeterminado',
      description: 'Personalidad más fuerte con control total sobre la configuración de Contempt.',
    },
    Aggressive: {
      label: 'Agresivo',
      description: 'Ataca sin descanso, prefiere piezas activas, sesgado hacia el juego de Dama.',
    },
    Defensive: {
      label: 'Defensivo',
      description: 'Enfatiza la seguridad del rey y la posición sólida por encima de todo.',
    },
    Active: {
      label: 'Activo',
      description: 'Tiende hacia posiciones abiertas y piezas bien ubicadas.',
    },
    Positional: {
      label: 'Posicional',
      description: 'Juego sólido, maniobras, posiciones más cerradas.',
    },
    Endgame: {
      label: 'Final',
      description: 'Prefiere jugar hasta ganar promocionando un peón.',
    },
    Beginner: {
      label: 'Principiante',
      description: 'No entiende los fundamentos, busca dar jaque y capturar.',
    },
    Human: {
      label: 'Humano',
      description: 'Optimizado para jugar como jugadores humanos fuertes.',
    },
  },

  engine: {
    title: 'Configuración del Motor',
    riskTaking: 'Toma de Riesgos',
    riskTakingDesc: 'Nivel de riesgo aceptado para ganar',
    timePerMove: 'Tiempo',
    analysisLines: 'Líneas de Análisis',
  },

  display: {
    title: 'Visualización',
    showArrows: 'Mostrar Flechas',
    showEvalBar: 'Mostrar Barra de Eval',
    evalBarMode: 'Modo de visualización',
    evalBarModeEval: 'Evaluación',
    evalBarModeWinrate: '% Victoria',
    blunderThreshold: 'Umbral de Error Grave',
  },

  suggestions: {
    title: 'Sugerencias',
    numberOfSuggestions: 'Número de Sugerencias',
    useSameColor: 'Usar el mismo color',
    firstSuggestion: '1ª Sugerencia',
    secondSuggestion: '2ª Sugerencia',
    thirdSuggestion: '3ª Sugerencia',
    singleColor: 'Color de Sugerencias',
    showQualityLabels: 'Mostrar etiquetas de calidad',
    showQualityLabelsDesc: 'Mostrar etiquetas Mejor/Seguro/Arriesgado en las flechas',
    showEffectLabels: 'Mostrar etiquetas de efectos',
    showEffectLabelsDesc: 'Mostrar etiquetas mate/jaque/captura/promoción en las flechas',
  },

  openings: {
    title: 'Aperturas',
    nextMove: 'Siguiente jugada',
    completed: 'Apertura completada',
    detected: 'Apertura detectada',
    waitingForWhite: 'Esperando el primer movimiento de las blancas...',
    noOpening: 'No hay apertura disponible',
  },

  settings: {
    title: 'Configuración',
    language: 'Idioma',
    automatic: 'Automático',
    french: 'Français',
    english: 'English',
    spanish: 'Español',
    russian: 'Русский',
    german: 'Deutsch',
    portuguese: 'Português',
    hindi: 'हिन्दी',
    detected: 'detectado',
  },

  advanced: {
    title: 'Avanzado',
    showAlwaysBestMoveFirst: 'Mostrar siempre la mejor jugada primero',
    showAlwaysBestMoveFirstDesc: 'La primera sugerencia es siempre la mejor jugada del motor.',
    allowBrilliant: 'Permitir jugadas brillantes',
    allowBrilliantDesc: 'Mostrar jugadas que sacrifican material por posiciones fuertes.',
  },

  feedback: {
    title: 'Detalles de Jugadas',
    showSuggestions: 'Mostrar sugerencias detalladas',
    showSuggestionsDesc: 'Mostrar tarjetas con jugadas, efectos y calidad',
    showRollingAccuracy: 'Mostrar estadísticas del juego',
    showRollingAccuracyDesc: 'Mostrar widget con precisión y clasificación de jugadas para todo el juego',
  },

  badges: {
    best: 'Mejor',
    safe: 'Seguro',
    risky: 'Arriesgado',
    human: 'Humano',
    alt: 'Alt',
    promotion: 'Promoción',
    mate: 'Mate',
    check: 'Jaque',
    capture: 'Captura',
    lowRisk: 'Riesgo bajo',
    mediumRisk: 'Riesgo medio',
    highRisk: 'Riesgo alto',
  },

  tabs: {
    general: 'General',
    display: 'Visualización',
    suggestions: 'Sugerencias',
    feedback: 'Detalles',
  },

  version: {
    title: 'Actualización Requerida',
    message: 'Tu versión de Chessr ya no es compatible. Por favor actualiza para continuar usando la extensión.',
    current: 'Actual',
    required: 'Requerida',
    download: 'Descargar Actualización',
  },

  auth: {
    login: 'Iniciar Sesión',
    signup: 'Registrarse',
    forgotPassword: 'Olvidé mi Contraseña',
    loginSubtitle: 'Inicia sesión para acceder a Chessr',
    signupSubtitle: 'Crea una cuenta para comenzar',
    resetSubtitle: 'Ingresa tu email para restablecer',
    email: 'Email',
    emailPlaceholder: 'email@ejemplo.com',
    password: 'Contraseña',
    passwordPlaceholder: '••••••••',
    confirmPassword: 'Confirmar Contraseña',
    loginButton: 'Iniciar Sesión',
    signupButton: 'Registrarse',
    resetButton: 'Enviar Enlace',
    forgotPasswordLink: '¿Olvidaste tu contraseña?',
    noAccount: '¿No tienes cuenta?',
    signupLink: 'Regístrate',
    hasAccount: '¿Ya tienes una cuenta?',
    loginLink: 'Inicia sesión',
    backToLogin: 'Volver al inicio de sesión',
    passwordMismatch: 'Las contraseñas no coinciden',
    passwordTooShort: 'La contraseña debe tener al menos 6 caracteres',
    accountCreated: '¡Cuenta creada!',
    verifyYourEmail: 'Verifica tu email',
    emailSentTo: 'Se ha enviado un email a:',
    resendEmail: 'Reenviar email',
    emailResent: '¡Email enviado!',
    resetEmailSent: '¡Email de restablecimiento enviado!',
  },
};
