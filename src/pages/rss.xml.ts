import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { byDateDesc } from "../utils/date";

export async function GET(context: any) {
	const allPosts = await getCollection("post", ({ data }) => !data.draft);
	const sortedPosts = allPosts.sort(byDateDesc);

	return rss({
		title: "姜小小",
		description: "生活感悟与技术探索",
		site: context.site,
		items: sortedPosts.map((post) => ({
			title: post.data.title,
			pubDate: post.data.date,
			description: post.data.description || post.data.title,
			link: `/post/${post.slug}`,
		})),
		customData: `<language>zh-CN</language>`,
	});
}
