import { Translations } from '../types';

export const ru: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    myColor: 'Мой цвет',
    turn: 'Ход',
    white: 'Белые',
    black: 'Чёрные',
    lastGamePlayed: 'Последняя Сыгранная Партия',
  },

  analysis: {
    eval: 'Оценка',
    centipawns: 'Сантипешки',
    move: 'Ход',
    mateIn: 'Мат в',
    depth: 'Глубина',
    reanalyze: 'Переанализировать',
  },

  elo: {
    title: 'Целевой ELO',
    display: 'Отображение Chess.com',
    antiCheat: 'Рандомизация ELO ±100',
  },

  personalities: {
    title: 'Личность',
    Default: {
      label: 'По умолчанию',
      description: 'Самая сильная личность с полным контролем над настройкой Contempt.',
    },
    Aggressive: {
      label: 'Агрессивный',
      description: 'Атакует безжалостно, предпочитает активные фигуры, предвзят к игре ферзём.',
    },
    Defensive: {
      label: 'Оборонительный',
      description: 'Подчёркивает безопасность короля и прочную позицию превыше всего.',
    },
    Active: {
      label: 'Активный',
      description: 'Тяготеет к открытым позициям и хорошо размещённым фигурам.',
    },
    Positional: {
      label: 'Позиционный',
      description: 'Прочная игра, маневрирование, более закрытые позиции.',
    },
    Endgame: {
      label: 'Эндшпиль',
      description: 'Предпочитает игру до победы путём продвижения пешки.',
    },
    Beginner: {
      label: 'Начинающий',
      description: 'Не понимает основ, стремится к шахам и взятиям.',
    },
    Human: {
      label: 'Человеческий',
      description: 'Оптимизирован для игры как сильные игроки-люди.',
    },
  },

  engine: {
    title: 'Настройки Движка',
    searchMode: 'Режим Поиска',
    depth: 'Глубина',
    timePerMove: 'Время',
    analysisLines: 'Линии Анализа',
  },

  display: {
    title: 'Отображение',
    showArrows: 'Показывать Стрелки',
    showEvalBar: 'Показывать Шкалу Оценки',
    blunderThreshold: 'Порог Грубой Ошибки',
  },

  suggestions: {
    title: 'Предложения',
    numberOfSuggestions: 'Количество Предложений',
    useSameColor: 'Использовать тот же цвет',
    firstSuggestion: '1-е Предложение',
    secondSuggestion: '2-е Предложение',
    thirdSuggestion: '3-е Предложение',
    singleColor: 'Цвет Предложений',
    showQualityLabels: 'Показывать метки качества',
    showQualityLabelsDesc: 'Отображать метки Лучший/Безопасный/Рискованный на стрелках',
    showEffectLabels: 'Показывать метки эффектов',
    showEffectLabelsDesc: 'Отображать метки мат/шах/взятие/превращение на стрелках',
  },

  openings: {
    title: 'Дебюты',
    nextMove: 'Следующий ход',
    completed: 'Дебют завершён',
    detected: 'Дебют обнаружен',
    waitingForWhite: 'Ожидание первого хода белых...',
    noOpening: 'Нет доступного дебюта',
  },

  settings: {
    title: 'Настройки',
    language: 'Язык',
    automatic: 'Автоматически',
    french: 'Français',
    english: 'English',
    spanish: 'Español',
    russian: 'Русский',
    german: 'Deutsch',
    portuguese: 'Português',
    hindi: 'हिन्दी',
    detected: 'обнаружен',
  },

  advanced: {
    title: 'Расширенные',
    showAlwaysBestMoveFirst: 'Всегда показывать лучший ход первым',
    showAlwaysBestMoveFirstDesc: 'Первое предложение всегда лучший ход движка.',
    allowBrilliant: 'Разрешить блестящие ходы',
    allowBrilliantDesc: 'Показывать ходы, жертвующие материал ради сильных позиций.',
  },

  feedback: {
    title: 'Детали Ходов',
    showSuggestions: 'Показывать детальные предложения',
    showSuggestionsDesc: 'Отображать карточки с ходами, эффектами и качеством',
    showRollingAccuracy: 'Показывать скользящую точность',
    showRollingAccuracyDesc: 'Отображать виджет точности для последних 10 ходов',
  },

  badges: {
    best: 'Лучший',
    safe: 'Безопасный',
    risky: 'Рискованный',
    human: 'Человеческий',
    alt: 'Альт',
    promotion: 'Превращение',
    mate: 'Мат',
    check: 'Шах',
    capture: 'Взятие',
    lowRisk: 'Низкий риск',
    mediumRisk: 'Средний риск',
    highRisk: 'Высокий риск',
  },

  tabs: {
    general: 'Общие',
    display: 'Отображение',
    suggestions: 'Предложения',
    feedback: 'Детали',
  },

  version: {
    title: 'Требуется Обновление',
    message: 'Ваша версия Chessr больше не поддерживается. Пожалуйста, обновите, чтобы продолжить использование расширения.',
    current: 'Текущая',
    required: 'Требуется',
    download: 'Скачать Обновление',
  },

  auth: {
    login: 'Вход',
    signup: 'Регистрация',
    forgotPassword: 'Забыли Пароль',
    loginSubtitle: 'Войдите для доступа к Chessr',
    signupSubtitle: 'Создайте аккаунт, чтобы начать',
    resetSubtitle: 'Введите email для сброса',
    email: 'Email',
    emailPlaceholder: 'email@example.com',
    password: 'Пароль',
    passwordPlaceholder: '••••••••',
    confirmPassword: 'Подтвердите Пароль',
    loginButton: 'Войти',
    signupButton: 'Зарегистрироваться',
    resetButton: 'Отправить Ссылку',
    forgotPasswordLink: 'Забыли пароль?',
    noAccount: 'Нет аккаунта?',
    signupLink: 'Зарегистрируйтесь',
    hasAccount: 'Уже есть аккаунт?',
    loginLink: 'Войти',
    backToLogin: 'Вернуться к входу',
    passwordMismatch: 'Пароли не совпадают',
    passwordTooShort: 'Пароль должен содержать не менее 6 символов',
    accountCreated: 'Аккаунт создан!',
    verifyYourEmail: 'Подтвердите ваш email',
    emailSentTo: 'Письмо отправлено на:',
    resendEmail: 'Отправить повторно',
    emailResent: 'Письмо отправлено!',
    resetEmailSent: 'Письмо для сброса отправлено!',
  },
};
