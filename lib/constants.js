import {
	Clapperboard,
	Heart,
	Laugh,
	Moon,
	Rocket,
} from 'lucide-react';

export const pageVariants = {
	initial: { opacity: 0, y: 12 },
	animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
	exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: 'easeIn' } },
};

export const GENRE_LIST = [
	'Action',
	'Adventure',
	'Animation',
	'Comedy',
	'Crime',
	'Documentary',
	'Drama',
	'Family',
	'Fantasy',
	'Horror',
	'Mystery',
	'Romance',
	'Science Fiction',
	'Thriller',
];

export const GENRE_ICONS = {
	Action: '💥',
	Adventure: '🧭',
	'Action & Adventure': '🧭',
	Animation: '🎨',
	Comedy: '😂',
	Crime: '🕵️',
	Documentary: '🎬',
	Drama: '🎭',
	Family: '👨‍👩‍👧‍👦',
	Fantasy: '🪄',
	Horror: '👻',
	Mystery: '🔍',
	Romance: '❤️',
	'Science Fiction': '🚀',
	'Sci-Fi & Fantasy': '🚀',
	Thriller: '⚡',
	War: '🪖',
	Western: '🤠',
};

export const MOODS = [
	{
		id: 'fun',
		label: 'Fun',
		desc: 'Léger et divertissant',
		icon: Laugh,
		color: 'from-pink-500 to-orange-400',
	},
	{
		id: 'love',
		label: 'Romance',
		desc: 'Doux et émotionnel',
		icon: Heart,
		color: 'from-rose-500 to-red-400',
	},
	{
		id: 'adrenaline',
		label: 'Adrénaline',
		desc: 'Action et tension',
		icon: Rocket,
		color: 'from-red-600 to-amber-500',
	},
	{
		id: 'dark',
		label: 'Sombre',
		desc: 'Intense et mature',
		icon: Moon,
		color: 'from-slate-700 to-zinc-500',
	},
	{
		id: 'cinema',
		label: 'Cinéma',
		desc: 'Grand spectacle',
		icon: Clapperboard,
		color: 'from-indigo-600 to-purple-500',
	},
];

export const ERAS = [
	{ id: 'any', label: 'Toutes', desc: 'Peu importe la date' },
	{ id: 'modern', label: '2015+', desc: 'Récentes et modernes' },
	{ id: 'classic2000', label: '2000-2014', desc: 'Classiques modernes' },
	{ id: 'retro', label: '< 2000', desc: 'Cultes rétro' },
];

export const DURATIONS = [
	{ id: 'short', label: 'Court', desc: '≤ 2h (ou épisodes rapides)' },
	{ id: 'medium', label: 'Moyen', desc: '45m à 3h' },
	{ id: 'long', label: 'Long', desc: 'Session plus longue' },
	{ id: 'any', label: 'Peu importe', desc: 'Durée libre' },
];

export function formatTime(seconds) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
	}
	return `${minutes}:${String(secs).padStart(2, '0')}`;
}
