import { Translations } from '../types';

export const pt: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    myColor: 'Minha cor',
    turn: 'Turno',
    white: 'Brancas',
    black: 'Pretas',
    lastGamePlayed: 'Última Partida Jogada',
  },

  analysis: {
    eval: 'Aval',
    centipawns: 'Centipeões',
    move: 'Lance',
    mateIn: 'Mate em',
    reanalyze: 'Reanalisar',
  },

  elo: {
    title: 'ELO Alvo',
    display: 'Exibição Chess.com',
    antiCheat: 'Aleatorização ELO ±100',
    fullStrength: 'Modo Força Máxima',
    fullStrengthDesc: 'Desativar limite ELO para sugestões de força máxima (disponível a partir de 2000 ELO)',
  },

  personalities: {
    title: 'Personalidade',
    Default: {
      label: 'Motor',
      description: 'Joga como um motor com erros mínimos.',
    },
    Aggressive: {
      label: 'Agressivo',
      description: 'Ataca implacavelmente, prefere peças ativas, tendência ao jogo de Dama.',
    },
    Defensive: {
      label: 'Defensivo',
      description: 'Enfatiza a segurança do rei e posição sólida acima de tudo.',
    },
    Active: {
      label: 'Ativo',
      description: 'Tende para posições abertas e peças bem colocadas.',
    },
    Positional: {
      label: 'Posicional',
      description: 'Jogo sólido, manobras, posições mais fechadas.',
    },
    Endgame: {
      label: 'Final',
      description: 'Prefere jogar até vencer promovendo um peão.',
    },
    Beginner: {
      label: 'Iniciante',
      description: 'Não entende os fundamentos, procura dar xeque e capturar.',
    },
    Human: {
      label: 'Humano',
      description: 'Otimizado para jogar como jogadores humanos fortes.',
    },
  },

  armageddon: {
    title: 'Armageddon',
    off: 'Desativado',
    whiteMustWin: 'Brancas devem ganhar',
    blackMustWin: 'Pretas devem ganhar',
    description: 'Empate conta como derrota para o lado escolhido',
    warning: 'Motor em potência máxima - Alto risco de detecção',
  },

  engine: {
    title: 'Configurações do Motor',
    riskTaking: 'Tomada de Risco',
    riskTakingDesc: 'Nível de risco aceito para chances de vitória',
    skill: 'Habilidade',
    skillDesc: 'Nível de força do motor',
    timePerMove: 'Tempo',
    analysisLines: 'Linhas de Análise',
  },

  display: {
    title: 'Exibição',
    showArrows: 'Mostrar Setas',
    showEvalBar: 'Mostrar Barra de Aval',
    evalBarMode: 'Modo de exibição',
    evalBarModeEval: 'Avaliação',
    evalBarModeWinrate: '% Vitória',
    blunderThreshold: 'Limite de Erro Grave',
  },

  suggestions: {
    title: 'Sugestões',
    numberOfSuggestions: 'Número de Sugestões',
    useSameColor: 'Usar a mesma cor',
    firstSuggestion: '1ª Sugestão',
    secondSuggestion: '2ª Sugestão',
    thirdSuggestion: '3ª Sugestão',
    singleColor: 'Cor das Sugestões',
    showQualityLabels: 'Mostrar etiquetas de qualidade',
    showQualityLabelsDesc: 'Exibir etiquetas Melhor/Seguro/Arriscado nas setas',
    showEffectLabels: 'Mostrar etiquetas de efeitos',
    showEffectLabelsDesc: 'Exibir etiquetas mate/xeque/captura/promoção nas setas',
  },

  openings: {
    title: 'Aberturas',
    nextMove: 'Próximo lance',
    completed: 'Abertura completa',
    detected: 'Abertura detectada',
    waitingForWhite: 'Aguardando primeiro lance das brancas...',
    noOpening: 'Nenhuma abertura disponível',
  },

  settings: {
    title: 'Configurações',
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
    title: 'Avançado',
    showAlwaysBestMoveFirst: 'Sempre mostrar o melhor lance primeiro',
    showAlwaysBestMoveFirstDesc: 'A primeira sugestão é sempre o melhor lance do motor.',
    allowBrilliant: 'Permitir lances brilhantes',
    allowBrilliantDesc: 'Mostrar lances que sacrificam material por posições fortes.',
  },

  feedback: {
    title: 'Detalhes dos Lances',
    showSuggestions: 'Mostrar sugestões detalhadas',
    showSuggestionsDesc: 'Exibir cartões com lances, efeitos e qualidade',
    showRollingAccuracy: 'Mostrar estatísticas do jogo',
    showRollingAccuracyDesc: 'Exibir widget com precisão e classificação de lances para todo o jogo',
  },

  badges: {
    best: 'Melhor',
    safe: 'Seguro',
    risky: 'Arriscado',
    human: 'Humano',
    alt: 'Alt',
    promotion: 'Promoção',
    mate: 'Mate',
    check: 'Xeque',
    capture: 'Captura',
    lowRisk: 'Risco baixo',
    mediumRisk: 'Risco médio',
    highRisk: 'Risco alto',
  },

  tabs: {
    general: 'Geral',
    display: 'Exibição',
    suggestions: 'Sugestões',
    feedback: 'Detalhes',
  },

  version: {
    title: 'Atualização Necessária',
    message: 'Sua versão do Chessr não é mais suportada. Por favor, atualize para continuar usando a extensão.',
    current: 'Atual',
    required: 'Necessária',
    download: 'Baixar Atualização',
  },

  auth: {
    login: 'Entrar',
    signup: 'Cadastrar',
    forgotPassword: 'Esqueci a Senha',
    loginSubtitle: 'Entre para acessar o Chessr',
    signupSubtitle: 'Crie uma conta para começar',
    resetSubtitle: 'Digite seu email para redefinir',
    email: 'Email',
    emailPlaceholder: 'email@exemplo.com',
    password: 'Senha',
    passwordPlaceholder: '••••••••',
    confirmPassword: 'Confirmar Senha',
    loginButton: 'Entrar',
    signupButton: 'Cadastrar',
    resetButton: 'Enviar Link',
    forgotPasswordLink: 'Esqueceu a senha?',
    noAccount: 'Não tem conta?',
    signupLink: 'Cadastre-se',
    hasAccount: 'Já tem uma conta?',
    loginLink: 'Entre',
    backToLogin: 'Voltar ao login',
    passwordMismatch: 'As senhas não coincidem',
    passwordTooShort: 'A senha deve ter pelo menos 6 caracteres',
    accountCreated: 'Conta criada!',
    verifyYourEmail: 'Verifique seu email',
    emailSentTo: 'Um email foi enviado para:',
    resendEmail: 'Reenviar email',
    emailResent: 'Email enviado!',
    resetEmailSent: 'Email de redefinição enviado!',
  },
};
