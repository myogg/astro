/** @type {import('tailwindcss').Config} */
export default {
	darkMode: "class",
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			fontFamily: {
				sans: ['"Microsoft YaHei"', '"PingFang SC"', '"Hiragino Sans GB"', '"Source Han Sans SC"', '"Noto Sans CJK SC"', 'system-ui', 'sans-serif'],
				serif: ['"Microsoft YaHei"', '"PingFang SC"', '"Hiragino Sans GB"', '"Source Han Sans SC"', '"Noto Sans CJK SC"', 'system-ui', 'sans-serif'],
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
