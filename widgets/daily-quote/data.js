// Built-in entries: [text, author] for quotes, [word, meaning] for words.
const DATA = {
  quote: {
    en: [
      ["Well begun is half done.", "Aristotle"],
      ["The only way out is through.", "Robert Frost"],
      ["What we think, we become.", "Buddha"],
      ["Simplicity is the ultimate sophistication.", "Leonardo da Vinci"],
      ["It always seems impossible until it is done.", "Nelson Mandela"],
      ["He who has a why to live can bear almost any how.", "Friedrich Nietzsche"],
      ["The best way out is always through.", "Robert Frost"],
      ["Fall seven times, stand up eight.", "Japanese proverb"],
      ["Do what you can, with what you have, where you are.", "Theodore Roosevelt"],
      ["A journey of a thousand miles begins with a single step.", "Lao Tzu"],
      ["Done is better than perfect.", "Sheryl Sandberg"],
      ["Knowing yourself is the beginning of all wisdom.", "Aristotle"],
      ["You miss one hundred percent of the shots you don't take.", "Wayne Gretzky"],
      ["Make it work, make it right, make it fast.", "Kent Beck"]
    ],
    de: [
      ["Aller Anfang ist schwer.", "Sprichwort"],
      ["Der Weg ist das Ziel.", "Konfuzius"],
      ["Es gibt nichts Gutes, außer man tut es.", "Erich Kästner"],
      ["Wer immer tut, was er schon kann, bleibt immer das, was er schon ist.", "Henry Ford"],
      ["Man sieht nur mit dem Herzen gut.", "Antoine de Saint-Exupéry"],
      ["Das Glück ist eine Tochter der Arbeit.", "Sprichwort"],
      ["Wer aufhört, besser zu werden, hat aufgehört, gut zu sein.", "Marie von Ebner-Eschenbach"],
      ["Nichts ist so beständig wie der Wandel.", "Heraklit"],
      ["Übung macht den Meister.", "Sprichwort"],
      ["Wage zu wissen.", "Immanuel Kant"],
      ["Ein Lächeln ist der kürzeste Weg zwischen zwei Menschen.", "Victor Borge"],
      ["Die Dosis macht das Gift.", "Paracelsus"],
      ["Der Mensch ist nur da ganz Mensch, wo er spielt.", "Friedrich Schiller"],
      ["Geduld ist die Kunst, nur langsam wütend zu werden.", "Sprichwort"]
    ]
  },
  word: {
    en: [
      ["Petrichor", "The earthy smell after rain."],
      ["Ephemeral", "Lasting for a very short time."],
      ["Serendipity", "A happy discovery made by chance."],
      ["Sonder", "Realising everyone has a life as vivid as yours."],
      ["Luminous", "Giving off a soft, steady light."],
      ["Eloquent", "Fluent and persuasive in speech."],
      ["Solitude", "The pleasant state of being alone."],
      ["Mellifluous", "Sweet and smooth to hear."],
      ["Halcyon", "Calm, peaceful, and happy."],
      ["Ineffable", "Too great to be put into words."],
      ["Resilient", "Quick to recover from difficulty."],
      ["Tranquil", "Free from disturbance; calm."],
      ["Ubiquitous", "Present everywhere at once."],
      ["Quixotic", "Idealistic in an impractical way."]
    ],
    de: [
      ["Fernweh", "Sehnsucht nach fernen Orten."],
      ["Geborgenheit", "Das Gefühl, sicher und aufgehoben zu sein."],
      ["Waldeinsamkeit", "Das Gefühl, allein im Wald zu sein."],
      ["Augenblick", "Ein sehr kurzer Moment."],
      ["Zeitgeist", "Der Geist einer bestimmten Epoche."],
      ["Gelassenheit", "Innere Ruhe, auch unter Druck."],
      ["Wanderlust", "Die Lust, zu Fuß in die Welt zu ziehen."],
      ["Sehnsucht", "Tiefes Verlangen nach etwas Unerreichtem."],
      ["Feierabend", "Das Ende des Arbeitstages."],
      ["Lebensfreude", "Freude am Dasein."],
      ["Bedächtig", "Ruhig und überlegt im Handeln."],
      ["Wohlklang", "Ein angenehmer, harmonischer Klang."],
      ["Mußestunde", "Eine Stunde freier, ruhiger Zeit."],
      ["Frühlingserwachen", "Das Wiedererwachen der Natur im Frühling."]
    ]
  }
};
