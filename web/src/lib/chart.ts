// Chart.js za portal: registracija + barve iz teme strani (CSS spremenljivke), da se grafi ujemajo z
// dizajnom. Serije nosijo barvo razreda (identiteta junaka), vse ostalo (mreža, osi, tooltip) temo.
import { Chart, registerables, type Plugin } from 'chart.js';

Chart.register(...registerables);

let probe: CanvasRenderingContext2D | null = null;
const cache = new Map<string, [number, number, number, number]>();

/** Katerakoli CSS barva (oklch, hex …) -> rgba komponente (prek 1×1 platna, brskalnik razčleni). */
function rgbaOf(color: string): [number, number, number, number] {
	const hit = cache.get(color);
	if (hit) return hit;
	probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!probe) return [200, 200, 200, 1];
	probe.clearRect(0, 0, 1, 1);
	probe.fillStyle = '#000';
	probe.fillStyle = color;
	probe.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
	const out: [number, number, number, number] = [r, g, b, a / 255];
	cache.set(color, out);
	return out;
}

/** Barva s prosojnostjo (`alpha('#c69b6d', 0.3)`, `alpha('oklch(…)', 0.5)`). */
export function alpha(color: string, a: number) {
	const [r, g, b, a0] = rgbaOf(color);
	return `rgba(${r}, ${g}, ${b}, ${+(a0 * a).toFixed(3)})`;
}

const cssVar = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

/** `var(--x)` -> dejanska barva (platno ne razume CSS spremenljivk); ostalo nespremenjeno. */
export function resolveColor(color: string) {
	const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
	return m ? alpha(cssVar(m[1]), 1) : color;
}

/** Barve teme za grafe (preberi ob ustvarjanju grafa – tema je lahko svetla ali temna). */
export function chartTheme() {
	const fg = cssVar('--foreground');
	const muted = cssVar('--muted-foreground');
	return {
		fg: alpha(fg, 1),
		muted: alpha(muted, 1),
		grid: alpha(muted, 0.12),
		primary: alpha(cssVar('--primary'), 1),
		card: alpha(cssVar('--card'), 1),
		popover: alpha(cssVar('--popover'), 0.96),
		border: alpha(cssVar('--border'), 1),
		good: 'rgb(74, 222, 128)',
		bad: 'rgb(248, 113, 113)'
	};
}
export type ChartTheme = ReturnType<typeof chartTheme>;

/** Skupne nastavitve: tanke črte, tiha mreža, tooltip v barvah teme, brez animacije ob reduce-motion. */
export function baseOptions(t: ChartTheme) {
	const reduce =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	return {
		responsive: true,
		maintainAspectRatio: false,
		animation: reduce ? (false as const) : { duration: 450 },
		interaction: { mode: 'index' as const, intersect: false },
		font: { family: 'Inter Variable, Inter, sans-serif' },
		plugins: {
			legend: { display: false },
			tooltip: {
				backgroundColor: t.popover,
				borderColor: t.border,
				borderWidth: 1,
				titleColor: t.muted,
				bodyColor: t.fg,
				padding: 10,
				cornerRadius: 8,
				boxPadding: 4,
				usePointStyle: true
			}
		},
		scales: {
			x: {
				grid: { display: false },
				border: { color: t.grid },
				ticks: { color: t.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 16 }
			},
			y: {
				grid: { color: t.grid },
				border: { display: false },
				ticks: { color: t.muted, font: { size: 11 }, maxTicksLimit: 5 }
			}
		}
	};
}

/** Navpična črta ob kazalcu (crosshair) za črtne grafe. */
export const crosshair: Plugin = {
	id: 'crosshair',
	afterDatasetsDraw(chart) {
		const a = chart.tooltip?.getActiveElements?.();
		if (!a?.length) return;
		const x = a[0].element.x;
		const { top, bottom } = chart.chartArea;
		const ctx = chart.ctx;
		ctx.save();
		ctx.strokeStyle = alpha(cssVar('--muted-foreground'), 0.6);
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(x, top);
		ctx.lineTo(x, bottom);
		ctx.stroke();
		ctx.restore();
	}
};

export { Chart };
