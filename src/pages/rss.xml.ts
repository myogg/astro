import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context: any) {
	const allPosts = await getCollection("post");

	function parseDate(dateStr: string) {
		const [month, day, year] = dateStr.split(" ");
		return new Date(`${month} ${parseInt(day)}, ${year}`);
	}

	const sortedPosts = allPosts.sort(
		(a, b) => parseDate(b.data.dateFormatted).getTime() - parseDate(a.data.dateFormatted).getTime()
	);

	return rss({
		title: "xxjss",
		description: "生活感悟与技术探索",
		site: context.site,
		items: sortedPosts.map((post) => ({
			title: post.data.title,
			pubDate: parseDate(post.data.dateFormatted),
			description: post.data.description,
			link: `/post/${post.slug}`,
		})),
		customData: `<language>zh-CN</language>`,
	});
}
