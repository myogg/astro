const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/**
 * 展示用日期：`Apr 10, 2026`
 * 沿用原先 `dateFormatted` 字段的样式，保证页面观感不变。
 */
export function formatDisplayDate(date: Date): string {
	return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** `2026-04-10` */
export function formatISODate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** 按日期倒序（新的在前），供各列表页复用 */
export function byDateDesc(
	a: { data: { date: Date } },
	b: { data: { date: Date } },
): number {
	return b.data.date.getTime() - a.data.date.getTime();
}
