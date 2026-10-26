/** @type {import('tailwindcss').Config} */
export default {
	darkMode: "class",
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			fontFamily: {
				sans: ['"Noto Serif SC"', 'system-ui', '-apple-system', 'sans-serif'],
				serif: ['"Noto Serif SC"', 'Georgia', 'serif'],
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
