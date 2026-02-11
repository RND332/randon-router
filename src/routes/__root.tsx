import {
	HeadContent,
	Scripts,
	Link,
	createRootRouteWithContext,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";
import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "TanStack Start Starter",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Space+Grotesk:wght@400;600;700&display=swap",
			},
		],
	}),

	shellComponent: RootDocument,
	notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-slate-100">
			<h1 className="text-2xl font-semibold">Page not found</h1>
			<p className="max-w-md text-center text-sm text-slate-300">
				This route does not exist. Check the URL or return to the quote
				comparison.
			</p>
			<Link
				to="/"
				className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold transition hover:border-slate-500"
			>
				Go to dashboard
			</Link>
		</div>
	);
}
