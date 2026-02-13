import { createServerFn } from "@tanstack/react-start";
import BigNumber from "bignumber.js";
import { randomUUID } from "node:crypto";
import { readFile } from "fs/promises";
import { createRequire } from "module";

declare global {
	var __inchIdCounter: number | undefined;
}

export type OrderBy = "score" | "net" | "output";

type Calldata = {
	to: string;
	data: string;
};

type Token = {
	symbol: string;
	name: string;
	address: string;
	decimals: number;
	priceUsd: number;
};

type SimulationResult = {
	balanceOfBefore: string;
	balanceOfAfter: string;
	outputTokenAmount: string;
	outputToken: string;
	approveTxGasUsed: number;
	swapTxGasUsed: number;
	isSuccessful: boolean;
	simBlockNumber: string;
	simTime: string;
	simTimeTotal: string;
	requestId: string;
};

type RawQuote = {
	aggregator: string;
	amountOut: string | null;
	gasUsed: number | null;
	sources: string[] | null;
	rawResponse?: {} | null | undefined;
	calldataResponse: Calldata | null;
	simulationResult: SimulationResult | undefined;
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
const recipient = "0x40afefb746b5d79cecfd889d48fd1bc617deaa23";
const sender = "0x40afefb746b5d79cecfd889d48fd1bc617deaa23";
const debrigdeRouter = "0x663dc15d3c1ac63ff12e45ab68fea3f0a883c251";

type ScraperOptions = {
	strictSSL?: boolean;
};

const require = createRequire(import.meta.url);
const cloudscraper = require("cloudscraper") as {
	defaults?: (options: { timeout: number }) => unknown;
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
	const body = init?.body;

	const requestOptions: Record<string, unknown> = {
		uri: url,
		method,
		headers,
		json: true,
		timeout: 20000,
	};

	if (body !== undefined) {
		requestOptions.body = body;
	}

	if (options?.strictSSL === false) {
		requestOptions.strictSSL = false;
	}

	return scraper(requestOptions);
};

const simulate = async (
	calldata: Calldata,
	tokenIn: string,
	outputToken: string,
	tokenInAmount: string,
	senderAddress: string = sender,
) => {
	return fetchJson(
		"https://dev.invisium.com/simulation/ethereum/sim-dln-output-amount",
		{
			method: "POST",
			body: {
				recipient: recipient,
				outputToken,
				tokenIn,
				tokenInAmount,
				tx: {
					from: senderAddress,
					to: calldata.to,
					input: calldata.data,
				},
			} as any,
			headers: {
				"content-type": "application/json",
			},
		},
	);
};

async function postScraperJson(url: string, payload: any, token: string) {
	return fetchJson(
		url,
		{
			method: "POST",
			body: payload,
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${token}`,
			},
		},
		{ strictSSL: false },
	);
}
const tokenListUrl = new URL("../../public/token-list.json", import.meta.url);

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

	const readyTokens = tokens
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
	return readyTokens;
};

const fetchTokenList = async () => {
	const content = await readFile(tokenListUrl, "utf-8");
	return JSON.parse(content) as unknown;
};

const getTokenListInternal = async (): Promise<Token[]> => {
	const response = await fetchTokenList();
	const tokens = normalizeTokenList(response);

	return tokens;
};

const findTokenBySymbol = (tokens: Token[], symbol: string) =>
	tokens.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase());

const fallbackTokenBySymbol = (symbol: string) =>
	findTokenBySymbol(fallbackTokenList, symbol);

export const getTokenList = createServerFn({
	method: "GET",
}).handler(async () => getTokenListInternal());

const fallbackQuote = (aggregator: string): RawQuote => ({
	aggregator,
	amountOut: "0",
	gasUsed: 0,
	sources: [],
	rawResponse: undefined,
	simulationResult: undefined,
	calldataResponse: null,
});

const calldataAggregators = new Set(["1Inch", "KyberSwap"]);

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
	const url = `https://dc1.invisium.com/router/ethereum/quote?asset_in=${tokenIn.address}&asset_out=${tokenOut.address}&amount_in=${amountIn}&recipient=${recipient}&min_buy_amount=0`;
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
	const url = `https://dc1.invisium.com/router/ethereum/quote?asset_in=${tokenIn.address}&asset_out=${tokenOut.address}&amount_in=${amountIn}&recipient=${recipient}&simulate=true&min_buy_amount=0&disable_price=${disablePrice}${chunkParam}`;
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
	const calldata = { to: res.settler_address, data: res.call };
	let simulation = null;
	try {
		simulation = await simulate(
			calldata,
			tokenIn.address,
			tokenOut.address,
			amountIn,
			debrigdeRouter,
		);
	} catch (error) {
		console.warn("BlazingRouter failed simulation");
	}

	console.log(`Blazing chunks ${chunkNumber === null ? "default" : chunkNumber} ${sources} ${amountIn} ${url}`)

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
		rawResponse: res,
		calldataResponse: calldata,
		simulationResult: simulation,
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
	let calldataResponse: any | null = null;
	if (calldataAggregators.has("KyberSwap")) {
		let deadline = Math.floor(Date.now() / 1000 + 10 * 60);
		try {
			calldataResponse = await postScraperJson(
				"https://aggregator-api.kyberswap.com/ethereum/api/v1/route/build",
				{
					routeSummary: res.data.routeSummary,
					deadline: deadline,
					enableGasEstimation: false,
					recipient: recipient,
					referral: "",
					sender: sender,
					skipSimulateTx: true,
					slippageTolerance: 5000,
					source: "kyberswap",
				},
				"eyJhbGciOiJSUzI1NiIsImtpZCI6IjYxZTIyYTA4LTYyYWQtNDYwMC04MGIzLWFlMDljNTIzOGNmMSIsInR5cCI6IkpXVCJ9.eyJhdWQiOltdLCJjbGllbnRfaWQiOiI4YTk1Y2VkOC0xNTMwLTQ1ZDAtYmMxNS1hNTYxNGQxZDhkMDgiLCJleHAiOjE3NzA3NjE0MTMsImV4dCI6e30sImlhdCI6MTc3MDc1NzgxMywiaXNzIjoiaHR0cHM6Ly9vYXV0aC1hcGkua3liZXJzd2FwLmNvbS8iLCJqdGkiOiJlOTAzN2I3MS04NDQ1LTQ2MGMtOWI3Yy05YzJmNWZhNThkYTciLCJuYmYiOjE3NzA3NTc4MTMsInNjcCI6W10sInN1YiI6IjM2ZDBlMmVhLTFhOTQtNDc3NC1iNjE1LTNiOGQyMmZjMTQxMCJ9.nVEf7izHsem5eCaGw1zNuAl7_pGm3Ypcq-Kg9tCQEJhHoeUKaIAYJaoxLPqS4Ce0kJV3cqVkYzEYcetz3YkhslS7k_7rapVJush7G0U2KGI4sHApGab1y9nzDP4aAytt05NHEp5UBikGmlsUWCUlukMdSuJ-J2gBGAcrHh58ZqQuYq94wKxKA31X0_W3X-jMulkvEnUMH_VdUmWkVn8WPv34f6bDeWUncF3uhia8bL4mtwrSzBxtL68Eu7SLIuZZrExAxou1BiSJJ6mvy2pgc_XLiRBcnhwUjDwmlnM0ZJ2NuYtFmHsMnTs55mUZgdNziA6C2b1SxXa14WCDmOwssIeAAopa3OBGsEw56UGbJ3docmDDNRUGIrvrul7kaagq2qbiXDLSnBVUeMHJ9mMjL9pOUOfsT4eNTOcVhfqxho8L1TWxbPrAjiCtNwjQlHaJ_N4t-i9Wpx6Sh8M8cRyieDWCpJLF5uD8-jDpImYp88kQQnrNft2HNhckCC-LzLwe8hmb0kZRexf8IfJVN4hBqOhYYKgAvpTN5i0dsIeNUzJWLd5EYww_pM5MMIOqje5-NeeGTpEK0PZ92YXegjT34bsBP8D5e9E-2tCp3iI7nLo2HuFw9CWNm-DsKYC3nHczhXBu6h0T6D2ykUD-6haR0cYAy8poEvEi7QRzaHlGTwE",
			);
		} catch (error) {
			console.warn("KyberSwap calldata build failed", error);
		}
	}
	const calldata = {
		to: calldataResponse.data.routerAddress,
		data: calldataResponse.data.data,
	};

	let simulation = null;
	try {
		simulation = await simulate(
			calldata,
			tokenIn.address,
			tokenOut.address,
			amountIn,
		);
	} catch (error) {
		console.warn("KyberSwap failed simulation");
	}

	return {
		aggregator: "KyberSwap",
		amountOut: summary.amountOut ? String(summary.amountOut) : "0",
		gasUsed: Number(summary.gas ?? 0),
		sources,
		rawResponse: res,
		calldataResponse: calldata,
		simulationResult: simulation,
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

	const url = `https://api.0x.org/swap/allowance-holder/quote?chainId=1&sellToken=${tokenIn.address}&buyToken=${tokenOut.address}&sellAmount=${amountIn}&taker=${recipient}`;
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

	const calldata = { to: res.transaction.to, data: res.transaction.data };
	let simulation = null;
	try {
		simulation = await simulate(
			calldata,
			tokenIn.address,
			tokenOut.address,
			amountIn,
		);
	} catch (error) {
		console.warn("0x failed simulation");
	}

	return {
		aggregator: "0x",
		amountOut: res?.buyAmount ? String(res.buyAmount) : "0",
		gasUsed: Number(res?.transaction?.gas ?? 0),
		sources,
		rawResponse: res,
		calldataResponse: calldata,
		simulationResult: simulation,
	};
};

const matcha = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
): Promise<RawQuote> => {
	const jwt = await getMatchaToken();
	const url = `https://matcha.xyz/api/swap/quote?chainId=1&buyToken=${tokenOut.address}&sellToken=${tokenIn.address}&sellAmount=${amountIn}&useIntents=false&taker=${recipient}&slippageBps=50`;
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

	const calldata = { to: res.transaction.to, data: res.transaction.data };
	let simulation = null;
	try {
		simulation = await simulate(
			calldata,
			tokenIn.address,
			tokenOut.address,
			amountIn,
		);
	} catch (error) {
		console.warn("Matcha failed simulation");
	}

	return {
		aggregator: "Matcha",
		amountOut: res?.buyAmount ? String(res.buyAmount) : "0",
		gasUsed: Number(res?.transaction?.gas ?? 0),
		sources,
		rawResponse: res,
		calldataResponse: calldata,
		simulationResult: simulation,
	};
};

const inch = async (
	tokenIn: Token,
	tokenOut: Token,
	amountIn: string,
): Promise<RawQuote> => {
	const url = `https://proxy-app.1inch.io/v2.0/v2.2/chain/1/router/v6/quotesv2?fromTokenAddress=${tokenIn.address}&toTokenAddress=${tokenOut.address}&amount=${amountIn}&gasPrice=148636342&preset=maxReturnResult&walletAddress=${sender}&excludedProtocols=PMM1,PMM2,PMM3,PMM4,PMM5,PMM6,PMM7,PMM8,PMM9,PMM10,PMM11,PMM12,PMM13,PMM14,PMM15,PMM16`;
	const token = await getInchToken();
	const res = await fetchJson(url, {
		method: "GET",
		headers: {
			"content-type": "application/json",

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

	let calldataResponse: any | null = null;
	if (calldataAggregators.has("1Inch")) {
		try {
			// Track request ID counter
			if (!globalThis.__inchIdCounter) {
				globalThis.__inchIdCounter = 0;
			}

			const requestId = randomUUID();
			// const requestId = `1dd1f0a7-ecbf-45ee-ad33-410b80679ccf:1`;
			globalThis.__inchIdCounter++;

			const data = {
				enableEstimate: false,
				expectedReturnAmount: res?.bestResult?.tokenAmount
					? String(res.bestResult.tokenAmount)
					: "0",
				fromTokenAddress: tokenIn.address,
				fromTokenAmount: amountIn,
				gasPrice: res?.bestResult?.gas,
				id: requestId,
				slippage: 5,
				toTokenAddress: tokenOut.address,
				walletAddress: sender,
			};
			const buildUrl = `https://proxy-app.1inch.io/v2.0/bff/v1.0/v6.0/1/build?version=2`;
			calldataResponse = await postScraperJson(buildUrl, data, token);
		} catch (error) {
			console.warn("1Inch calldata build failed", error);
		}
	}
	const calldata = {
		to: "0x111111125421cA6dc452d289314280a0f8842A65",
		data: calldataResponse.data,
	};
	let simulation: SimulationResult | undefined = undefined;
	try {
		simulation = await simulate(
			calldata,
			tokenIn.address,
			tokenOut.address,
			amountIn,
		);
	} catch (error) {
		console.warn("1Inch failed simulation");
	}
	return {
		aggregator: "1Inch",
		amountOut: res?.bestResult?.tokenAmount
			? String(res.bestResult.tokenAmount)
			: "0",
		gasUsed: Number(res?.bestResult?.gas ?? 0),
		sources,
		rawResponse: res,
		calldataResponse: calldata,
		simulationResult: simulation,
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
			: ({
					aggregator: tasks[index]?.label ?? "Unknown",
					amountOut: null,
					gasUsed: null,
					sources: null,
					rawResponse: null,
					calldataResponse: null,
					simulationResult: undefined,
					failed: true,
				} satisfies RawQuote),
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
		(item) => item.simulationResult?.outputTokenAmount !== undefined && !BigNumber(item.simulationResult?.swapTxGasUsed).plus(item.simulationResult?.approveTxGasUsed ?? 0).isZero(),
	);

	if (successful.length === 0) {
		return raw.map((item) => ({
			...item,
			netOutput: 0,
			distance: 0,
			score: Number.POSITIVE_INFINITY,
			failed: true,
		}));
	}

	const tokenAmountNumber = Number(amountIn);

	const withNet = raw.map((item) => {
		const isFailed = item.amountOut === null || item.gasUsed === null;
		const amountOut =
			item.amountOut === null ? new BigNumber(0) : new BigNumber(item.amountOut);
		const gasUsed =
			item.gasUsed === null ? new BigNumber(0) : new BigNumber(item.gasUsed);
		const gasCost = gasUsed.multipliedBy(gasPriceTokenIn);
		const netOutput = tokenAmountNumber
			? amountOut.minus(
					gasCost.multipliedBy(amountOut).dividedBy(tokenAmountNumber),
				)
			: amountOut;

		return {
			...item,
			netOutput: Number(netOutput.toFixed(18)),
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

		const distance =
			netOutputMax > 0
				? ((netOutputMax - item.netOutput) / netOutputMax) * 100
				: 0;

		return {
			...item,
			distance: Number.isFinite(distance) ? Number(distance.toFixed(8)) : 0,
		};
	});

	const successfulSimulations = withDistance.filter((item) => {
		const simulation = item.simulationResult;
		return (
			!!simulation?.isSuccessful &&
			Number.isFinite(Number(simulation.outputTokenAmount))
		);
	});

	if (successfulSimulations.length === 0) {
		return withDistance.map((item) => ({
			...item,
			score: Number.POSITIVE_INFINITY,
		}));
	}

	const simulationOutputValues = successfulSimulations.map((item) =>
		Number(item.simulationResult?.outputTokenAmount ?? 0),
	);
	const simulationGasValues = successfulSimulations.map((item) => {
		const simulation = item.simulationResult!;
		return simulation.approveTxGasUsed + simulation.swapTxGasUsed;
	});

	const simulationOutputMax = Math.max(...simulationOutputValues);
	const simulationOutputMin = Math.min(...simulationOutputValues);
	const simulationGasMax = Math.max(...simulationGasValues);
	const simulationGasMin = Math.min(...simulationGasValues);

	const sqrtTwo = new BigNumber(2).sqrt();

	return withDistance.map((item) => {
		const simulation = item.simulationResult;
		if (!simulation?.isSuccessful) {
			return {
				...item,
				score: Number.POSITIVE_INFINITY,
			};
		}

		const outputValue = new BigNumber(simulation.outputTokenAmount ?? 0);
		const gasValue = new BigNumber(simulation.approveTxGasUsed).plus(
			simulation.swapTxGasUsed,
		);

		if (!outputValue.isFinite() || !gasValue.isFinite()) {
			return {
				...item,
				score: Number.POSITIVE_INFINITY,
			};
		}

		const outputNorm =
			simulationOutputMax === simulationOutputMin
				? new BigNumber(1)
				: outputValue
						.minus(simulationOutputMin)
						.dividedBy(simulationOutputMax - simulationOutputMin);

		const gasNorm =
			simulationGasMax === simulationGasMin
				? new BigNumber(0)
				: gasValue.minus(simulationGasMin).dividedBy(simulationGasMax - simulationGasMin);

		const outputDelta = outputNorm.minus(1);
		const gasDelta = gasNorm.minus(0);

		const euclidean = outputDelta.pow(2).plus(gasDelta.pow(2)).sqrt();
		const normalized = euclidean.dividedBy(sqrtTwo); // 0..1
		const bounded = BigNumber.maximum(
			0,
			BigNumber.minimum(1, normalized),
		);

		return {
			...item,
			score: bounded.isFinite()
				? Number(bounded.decimalPlaces(6, BigNumber.ROUND_HALF_UP).toString())
				: Number.POSITIVE_INFINITY,
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
		const timeoutMs = 100_000;

		try {
			const result = await Promise.race<QuoteComparisonResult>([
				(async () => {
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
						BigNumber(gasPriceRaw),
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
						gasPriceTokenIn: gasPriceRaw,
						order,
						results: ordered,
						error: null,
						status: "success",
					};
				})(),
				new Promise<QuoteComparisonResult>((_, reject) =>
					setTimeout(
						() => reject(new Error("getQuoteComparison timed out after 100 seconds")),
						timeoutMs,
					),
				),
			]);

			return result;
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
