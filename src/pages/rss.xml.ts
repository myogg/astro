import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { byDateDesc } from "../utils/date";

export async function GET(context: any) {
	const allPosts = await getCollection("post", ({ data }) => !data.draft);
	const sortedPosts = allPosts.sort(byDateDesc);

	return rss({
		title: "灰太狼 - 做一个有意思的人",
		description: "灰太狼 - 做一个有意思的人",
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
