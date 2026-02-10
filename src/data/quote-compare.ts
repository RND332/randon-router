import { createServerFn } from "@tanstack/react-start";
import cloudscraper from "cloudscraper";
import BigNumber from "bignumber.js";

export type OrderBy = "score" | "net" | "output";

type Token = {
	symbol: string;
	name: string;
	address: string;
	decimals: number;
	priceUsd: number;
};

type RawQuote = {
	aggregator: string;
	amountOut: string | null;
	gasUsed: number | null;
	sources: string[] | null;
	failed?: boolean;
};

export type QuoteRow = RawQuote & {
	netOutput: number;
	distance: number;
	score: number;
};

export type QuoteComparisonInput = {
	tokenIn: string;
	tokenOut: string;
	tokenAmount: string;
	order?: OrderBy;
	disablePrice?: "true" | "false";
};

export type QuoteComparisonResult = {
	tokenIn: string;
	tokenOut: string;
	tokenAmount: string;
	tokenOutDecimals: number;
	gasPriceTokenIn: string;
	order: OrderBy;
	results: QuoteRow[];
	error: string | null;
	status: "success" | "error";
};

const fallbackTokensBySymbol: Record<string, Token> = {
	USDT: {
		symbol: "USDT",
		name: "USDT",
		address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
		decimals: 6,
		priceUsd: 0.99,
	},
	ETH: {
		symbol: "ETH",
		name: "ETH",
		address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		decimals: 18,
		priceUsd: 3321.0,
	},
	WETH: {
		symbol: "WETH",
		name: "WETH",
		address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
		decimals: 18,
		priceUsd: 3321.0,
	},
	USDC: {
		symbol: "USDC",
		name: "USDC",
		address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
		decimals: 6,
		priceUsd: 0.9,
	},
	WBTC: {
		symbol: "WBTC",
		name: "WBTC",
		address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
		decimals: 8,
		priceUsd: 86000.0,
	},
	CBBTC: {
		symbol: "cbBTC",
		name: "cbBTC",
		address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
		decimals: 8,
		priceUsd: 86000.0,
	},
};

export const fallbackTokenList = Object.values(fallbackTokensBySymbol);

const chunkSizes = [1, 5, 10, 15, 20, 30, 50, 75, 100, 125, 150, 200];

type ScraperOptions = {
	strictSSL?: boolean;
};

const scraper = (cloudscraper as any).defaults
	? (cloudscraper as any).defaults({ timeout: 20000 })
	: cloudscraper;

const fetchJson = async (
	url: string,
	init?: RequestInit,
	options?: ScraperOptions,
) => {
	const method = init?.method ?? "GET";
	const headers = {
		"content-type": "application/json",
		...(init?.headers ?? {}),
	};

	const requestOptions: Record<string, unknown> = {
		uri: url,
		method,
		headers,
		json: true,
		timeout: 20000,
	};

	if (options?.strictSSL === false) {
		requestOptions.strictSSL = false;
	}

	return scraper(requestOptions);
};

const tokenListUrl =
	"https://deswap.debridge.finance/v1.0/token-list?chainId=1";
const tokenListCacheTtl = 10 * 60;
let tokenListCache: { tokens: Token[]; exp: number } | null = null;

const toNumber = (value: unknown, fallback = 0) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeTokenList = (raw: unknown): Token[] => {
	const tokenSource = (raw as any)?.tokens ?? raw;
	const tokens = Array.isArray(tokenSource)
		? tokenSource
		: tokenSource && typeof tokenSource === "object"
			? Object.values(tokenSource as Record<string, unknown>)
			: [];

	return tokens
		.filter(
			(item: any) =>
				typeof item?.symbol === "string" && typeof item?.address === "string",
		)
		.map((item: any) => ({
			symbol: item.symbol,
			name: typeof item?.name === "string" ? item.name : item.symbol,
			address: item.address,
			decimals: toNumber(item.decimals, 18),
			priceUsd: toNumber(item.priceUSD ?? item.priceUsd, 0),
		}));
};

const fetchTokenList = async () => {
	if (typeof fetch === "function") {
		try {
			const response = await fetch(tokenListUrl, {
				method: "GET",
				headers: {
					accept: "application/json",
				},
			});
			if (!response.ok) {
				throw new Error(`Token list fetch failed: ${response.status}`);
			}
			return response.json();
		} catch {
			// Fall through to scraper-based fetch.
		}
	}

	return fetchJson(tokenListUrl, { method: "GET" }, { strictSSL: false });
};

const getTokenListInternal = async (): Promise<Token[]> => {
	const now = Math.floor(Date.now() / 1000);
	if (tokenListCache && tokenListCache.exp > now) {
		return tokenListCache.tokens;
	}

	try {
		const response = await fetchTokenList();
		const tokens = normalizeTokenList(response);
		if (tokens.length > 0) {
			tokenListCache = { tokens, exp: now + tokenListCacheTtl };
			return tokens;
		}
	} catch {
		// Ignore and fall back to static tokens.
	}

	const fallback = fallbackTokenList;
	tokenListCache = { tokens: fallback, exp: now + tokenListCacheTtl };
	return fallback;
};

const findTokenBySymbol = (tokens: Token[], symbol: string) =>
	tokens.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase());

const fallbackTokenBySymbol = (symbol: string) =>
	findTokenBySymbol(fallbackTokenList, symbol);

export const getTokenList = createServerFn({
	method: "GET",
}).handler(async () => getTokenListInternal());

const toGasPriceTokenIn = (rawValue: string): BigNumber => {
	const numeric = Number(rawValue);
	if (Number.isNaN(numeric)) {
		return new BigNumber(0);
	}

	return new BigNumber(rawValue).dividedBy(new BigNumber(2).pow(96));
};

const fallbackQuote = (aggregator: string): RawQuote => ({
	aggregator,
	amountOut: "0",
	gasUsed: 0,
	sources: [],
});

let matchaCache: { token: string; exp: number } | null = null;
let inchCache: { token: string; exp: number } | null = null;

const getMatchaToken = async () => {
	const now = Math.floor(Date.now() / 1000);
	if (matchaCache && matchaCache.exp > now) {
		return matchaCache.token;
	}

	const token = await fetchJson("https://matcha.xyz/api/jwt");
	matchaCache = { token: token.token, exp: token.exp };
	return matchaCache.token;
};

const getInchToken = async () => {
	const now = Math.floor(Date.now() / 1000);
	if (inchCache && inchCache.exp > now) {
		return inchCache.token;
	}

	const token = await fetchJson(
		"https://proxy-app.1inch.io/v2.0/auth/token?ngsw-bypass",
	);
	inchCache = { token: token.access_token, exp: token.exp };
	return inchCache.token;
};

const callBlazingTokenPrice = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
) => {
	const url = `https://dc1.invisium.com/router/ethereum/quote?asset_in=${tokenIn.address}&asset_out=${tokenOut.address}&amount_in=${amountIn}&recipient=0x40afefb746b5d79cecfd889d48fd1bc617deaa23&min_buy_amount=0`;
	const res = await fetchJson(url, { method: "GET" }, { strictSSL: false });
	return res.gas_price_token_in as string;
};

const callBlazingNew = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
	chunkNumber: number | null,
	disablePrice: "true" | "false",
): Promise<RawQuote> => {
	const chunkParam = chunkNumber === null ? "" : `&chunk_number=${chunkNumber}`;
	const url = `https://dc1.invisium.com/router/ethereum/quote?asset_in=${tokenIn.address}&asset_out=${tokenOut.address}&amount_in=${amountIn}&recipient=0x40afefb746b5d79cecfd889d48fd1bc617deaa23&simulate=true&min_buy_amount=0&disable_price=${disablePrice}${chunkParam}`;
	const res = await fetchJson(url, { method: "GET" }, { strictSSL: false });

	const routes = Array.isArray(res.route)
		? (res.route as Array<{ venue_type?: unknown }>)
		: [];
	const sources: string[] = [];
	routes.forEach((route) => {
		if (typeof route?.venue_type === "string") {
			sources.push(route.venue_type);
		}
	});

	return {
		aggregator:
			chunkNumber === null
				? "Blazing Default"
				: `Blazing chunks ${chunkNumber}`,
		amountOut: res.amount_out_estimated
			? String(res.amount_out_estimated)
			: "0",
		gasUsed: Number(res.gas_used ?? 0),
		sources,
	};
};

const kyberswap = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
): Promise<RawQuote> => {
	const url = `https://aggregator-api.kyberswap.com/ethereum/api/v1/routes?tokenIn=${tokenIn.address}&tokenOut=${tokenOut.address}&amountIn=${amountIn}&gasInclude=true`;
	const res = await fetchJson(url, { method: "GET" }, { strictSSL: false });
	const summary = res?.data?.routeSummary;
	if (!summary) {
		return fallbackQuote("KyberSwap");
	}

	const routes = Array.isArray(summary?.route)
		? (summary.route as Array<Array<{ poolType?: unknown }>>)
		: [];
	const sources = Array.from(
		new Set(
			routes.flatMap((path) =>
				path
					.map((part) =>
						typeof part?.poolType === "string" ? part.poolType : null,
					)
					.filter((value): value is string => typeof value === "string"),
			),
		),
	);

	return {
		aggregator: "KyberSwap",
		amountOut: summary.amountOut ? String(summary.amountOut) : "0",
		gasUsed: Number(summary.gas ?? 0),
		sources,
	};
};

const zeroEx = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
): Promise<RawQuote> => {
	const apiKey = process.env.ZEROX_API_KEY;
	if (!apiKey) {
		return fallbackQuote("0x");
	}

	const url = `https://api.0x.org/swap/allowance-holder/quote?chainId=1&sellToken=${tokenIn.address}&buyToken=${tokenOut.address}&sellAmount=${amountIn}&taker=0x40afefb746b5d79cecfd889d48fd1bc617deaa23`;
	const res = await fetchJson(url, {
		method: "GET",
		headers: {
			"0x-api-key": apiKey,
			"0x-version": "v2",
		},
	});

	const fills = res?.route?.fills;
	const sources = Array.isArray(fills)
		? fills.map((fill: { source: string }) => fill.source)
		: [];

	return {
		aggregator: "0x",
		amountOut: res?.buyAmount ? String(res.buyAmount) : "0",
		gasUsed: Number(res?.transaction?.gas ?? 0),
		sources,
	};
};

const matcha = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
): Promise<RawQuote> => {
	const jwt = await getMatchaToken();
	const url = `https://matcha.xyz/api/swap/price?chainId=1&buyToken=${tokenOut.address}&sellToken=${tokenIn.address}&sellAmount=${amountIn}&useIntents=true`;
	const res = await fetchJson(url, {
		method: "GET",
		headers: {
			"x-matcha-jwt": jwt,
		},
	});

	const fills = res?.route?.fills;
	const sources = Array.isArray(fills)
		? fills.map((fill: { source: string }) => fill.source)
		: [];

	return {
		aggregator: "Matcha",
		amountOut: res?.buyAmount ? String(res.buyAmount) : "0",
		gasUsed: Number(res?.gas ?? 0),
		sources,
	};
};

const inch = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
): Promise<RawQuote> => {
	const token = await getInchToken();
	const url = `https://proxy-app.1inch.io/v2.0/v2.2/chain/1/router/v6/quotesv2?fromTokenAddress=${tokenIn.address}&toTokenAddress=${tokenOut.address}&amount=${amountIn}&gasPrice=148636342&preset=maxReturnResult&walletAddress=0x40aFEfb746b5D79cecfD889D48Fd1bc617deaA23&excludedProtocols=PMM1,PMM2,PMM3,PMM4,PMM5,PMM6,PMM7,PMM8,PMM9,PMM10,PMM11,PMM12,PMM13,PMM14,PMM15,PMM16`;
	const res = await fetchJson(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	const levels = res?.bestResult?.levels;
	const sources = Array.isArray(levels)
		? Array.from(
				new Set(
					levels.flatMap((level: any) =>
						level.hops.flatMap((hop: any) =>
							hop.swaps.map((swap: any) => swap.market?.name).filter(Boolean),
						),
					),
				),
			)
		: [];

	return {
		aggregator: "1Inch",
		amountOut: res?.bestResult?.tokenAmount
			? String(res.bestResult.tokenAmount)
			: "0",
		gasUsed: Number(res?.bestResult?.gas ?? 0),
		sources,
	};
};

type QuoteTask = {
	label: string;
	promise: Promise<RawQuote>;
};

const settleQuotes = async (tasks: QuoteTask[]) => {
	const results = await Promise.allSettled(tasks.map((task) => task.promise));
	return results.map((result, index) =>
		result.status === "fulfilled"
			? result.value
			: {
					aggregator: tasks[index]?.label ?? "Unknown",
					amountOut: null,
					gasUsed: null,
					sources: null,
					failed: true,
				},
	);
};

const calculateScores = (
	raw: RawQuote[],
	amountIn: string,
	gasPriceTokenIn: BigNumber,
): QuoteRow[] => {
	if (raw.length === 0) {
		return [];
	}

	const successful = raw.filter(
		(item) => item.amountOut !== null && item.gasUsed !== null,
	);

	if (successful.length === 0) {
		return raw.map((item) => ({
			...item,
			netOutput: 0,
			distance: 0,
			score: 0,
			failed: true,
		}));
	}

	const amountOutValues = successful.map((item) => Number(item.amountOut));
	const gasUsedValues = successful.map((item) => Number(item.gasUsed));

	const amountOutMax = Math.max(...amountOutValues);
	const amountOutMin = Math.min(...amountOutValues);
	const gasUsedMax = Math.max(...gasUsedValues);
	const gasUsedMin = Math.min(...gasUsedValues);

	const tokenAmountNumber = Number(amountIn);

	const withNet = raw.map((item) => {
		const isFailed = item.amountOut === null || item.gasUsed === null;
		const amountOut = item.amountOut === null ? new BigNumber(0) : new BigNumber(item.amountOut);
		const gasUsed = item.gasUsed === null ? new BigNumber(0) : new BigNumber(item.gasUsed);
		const gasCost = gasUsed.multipliedBy(gasPriceTokenIn);
		const netOutput = tokenAmountNumber
			? amountOut.minus(gasCost.multipliedBy(amountOut).dividedBy(tokenAmountNumber))
			: amountOut;

		return {
			...item,
			netOutput: Number.isFinite(netOutput) ? Number(netOutput.toFixed(4)) : 0,
			distance: 0,
			score: 0,
			failed: item.failed ?? isFailed,
		};
	});

	const netOutputMax = Math.max(...withNet.map((item) => item.netOutput));

	const withDistance = withNet.map((item) => {
		if (item.failed) {
			return {
				...item,
				distance: 0,
			};
		}

		const distance = netOutputMax
			? ((netOutputMax - item.netOutput) / netOutputMax) * 100
			: 0;
		return {
			...item,
			distance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : 0,
		};
	});

	return withDistance.map((item) => {
		if (item.failed) {
			return {
				...item,
				score: 0,
			};
		}

		const amountOutValue = item.amountOut === null ? 0 : Number(item.amountOut);
		const gasUsedValue = item.gasUsed === null ? 0 : Number(item.gasUsed);
		const amountOutNorm =
			amountOutMax === amountOutMin
				? 0
				: (amountOutValue - amountOutMin) / (amountOutMax - amountOutMin);
		const gasCostNorm =
			gasUsedMax === gasUsedMin
				? 0
				: (gasUsedValue - gasUsedMin) / (gasUsedMax - gasUsedMin);

		const score = Math.sqrt(
			(amountOutNorm - amountOutMax) ** 2 + (gasCostNorm - gasUsedMin) ** 2,
		);

		return {
			...item,
			score: Number.isFinite(score) ? Number(score.toFixed(6)) : 0,
		};
	});
};

const toOrder = (value: QuoteComparisonInput["order"]): OrderBy => {
	if (value === "score" || value === "net" || value === "output") {
		return value;
	}
	return "net";
};

export const getQuoteComparison = createServerFn({
	method: "GET",
})
	.inputValidator((data: QuoteComparisonInput) => data)
	.handler(async ({ data }): Promise<QuoteComparisonResult> => {
	const tokenInSymbol = data?.tokenIn ?? "WETH";
	const tokenOutSymbol = data?.tokenOut ?? "WBTC";
	const tokenAmount = data?.tokenAmount ?? "1000000000000000000";
	const order = toOrder(data?.order);
	const disablePrice = data?.disablePrice ?? "false";

	try {
		const tokenList = await getTokenListInternal();
		const tokenIn =
			findTokenBySymbol(tokenList, tokenInSymbol) ??
			fallbackTokenBySymbol(tokenInSymbol);
		const tokenOut =
			findTokenBySymbol(tokenList, tokenOutSymbol) ??
			fallbackTokenBySymbol(tokenOutSymbol);

		if (!tokenIn || !tokenOut) {
			throw new Error("Unsupported token symbol");
		}

		const gasPriceRaw = await callBlazingTokenPrice(
			tokenIn,
			tokenOut,
			tokenAmount,
		);
		const gasPriceTokenIn = toGasPriceTokenIn(gasPriceRaw);

		const baseQuotes = await settleQuotes([
			{
				label: "KyberSwap",
				promise: kyberswap(tokenIn, tokenOut, tokenAmount),
			},
			{ label: "1Inch", promise: inch(tokenIn, tokenOut, tokenAmount) },
			{ label: "Matcha", promise: matcha(tokenIn, tokenOut, tokenAmount) },
			{ label: "0x", promise: zeroEx(tokenIn, tokenOut, tokenAmount) },
		]);

		const chunkQuotes = await settleQuotes(
			chunkSizes.map((chunk) => ({
				label: `Blazing chunks ${chunk}`,
				promise: callBlazingNew(
					tokenIn,
					tokenOut,
					tokenAmount,
					chunk,
					disablePrice,
				),
			})),
		);

		const defaultQuote = await settleQuotes([
			{
				label: "Blazing Default",
				promise: callBlazingNew(
					tokenIn,
					tokenOut,
					tokenAmount,
					null,
					disablePrice,
				),
			},
		]);

		const scored = calculateScores(
			[...baseQuotes, ...chunkQuotes, ...defaultQuote],
			tokenAmount,
			gasPriceTokenIn,
		);

		const ordered = [...scored];
		if (order === "score") {
			ordered.sort((a, b) => a.score - b.score);
		}
		if (order === "net") {
			ordered.sort((a, b) => b.netOutput - a.netOutput);
		}
		if (order === "output") {
			ordered.sort((a, b) => Number(b.amountOut) - Number(a.amountOut));
		}

		return {
			tokenIn: tokenInSymbol,
			tokenOut: tokenOutSymbol,
			tokenAmount,
			tokenOutDecimals: tokenOut.decimals,
			gasPriceTokenIn: gasPriceTokenIn.toString(),
			order,
			results: ordered,
			error: null,
			status: "success",
		};
	} catch (error) {
		console.error("Error in getQuoteComparison:", error);
		return {
			tokenIn: tokenInSymbol,
			tokenOut: tokenOutSymbol,
			tokenAmount,
			tokenOutDecimals: 0,
			gasPriceTokenIn: "0",
			order,
			results: [],
			error: error instanceof Error ? error.message : String(error),
			status: "error",
		};
	}
});
