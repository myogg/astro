/** @type {import('tailwindcss').Config} */
export default {
	darkMode: "class",
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
	theme: {
		extend: {
			fontFamily: {
				sans: ['"MiSans"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
				serif: ['"MiSans"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
