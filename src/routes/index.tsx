import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	type VisibilityState,
	useReactTable,
} from "@tanstack/react-table";
import { formatUnits, parseUnits } from "viem";
import {
	getQuoteComparison,
	fallbackTokenList,
	getTokenList,
	type OrderBy,
	type QuoteRow,
} from "../data/quote-compare";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import BigNumber from "bignumber.js";

type SearchState = {
	tokenIn: string;
	tokenOut: string;
	tokenAmount: string;
	order: OrderBy;
	disablePrice: "true" | "false";
};

const DEFAULT_TOKEN_AMOUNT = "1";

export const Route = createFileRoute("/")({
	validateSearch: (search): SearchState => {
		const stripQuotes = (value: string) => value.replace(/^\"|\"$/g, "");
		const coerceString = (value: unknown) => {
			if (typeof value === "string") {
				return value;
			}
			if (typeof value === "number" || typeof value === "boolean") {
				return String(value);
			}
			return "";
		};
		const cleanValue = (value: unknown) =>
			stripQuotes(coerceString(value).trim());

		const tokenInValue = cleanValue(search.tokenIn);
		const tokenOutValue = cleanValue(search.tokenOut);
		const tokenAmountValue = cleanValue(search.tokenAmount);
		const orderValue = cleanValue(search.order);
		const disablePriceValue = cleanValue(search.disablePrice);

		const tokenIn = tokenInValue.length > 0 ? tokenInValue : "WETH";
		const tokenOut = tokenOutValue.length > 0 ? tokenOutValue : "WBTC";
		const tokenAmount =
			tokenAmountValue.length > 0 ? tokenAmountValue : DEFAULT_TOKEN_AMOUNT;
		const order =
			orderValue === "score" || orderValue === "net" || orderValue === "output"
				? orderValue
				: "net";
		const disablePrice = disablePriceValue === "true" ? "true" : "false";

		return { tokenIn, tokenOut, tokenAmount, order, disablePrice };
	},
	component: App,
});

const columnHelper = createColumnHelper<QuoteRow>();

const formatDecimal = (value: number) =>
	new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 4,
	}).format(value);

const trimDecimals = (value: string, digits = 6) => {
	const [whole, fractional] = value.split(".");
	if (!fractional) {
		return value;
	}

	return `${whole}.${fractional.slice(0, digits)}`;
};

const toWeiEquivalent = (value: string, tokenDecimals: number) => {
	try {
		const rawAmount = BigInt(value);
		if (tokenDecimals === 18) {
			return rawAmount;
		}
		if (tokenDecimals < 18) {
			return rawAmount * 10n ** BigInt(18 - tokenDecimals);
		}
		return rawAmount / 10n ** BigInt(tokenDecimals - 18);
	} catch {
		return null;
	}
};

const formatWeiDisplay = (value: string, tokenDecimals: number) => {
	const weiEquivalent = toWeiEquivalent(value, tokenDecimals);
	if (weiEquivalent === null) {
		return value;
	}
	return weiEquivalent.toString();
};

const formatGweiDisplay = (
	value: string,
	tokenDecimals: number,
	digits = 6,
) => {
	const weiEquivalent = toWeiEquivalent(value, tokenDecimals);
	if (weiEquivalent === null) {
		return value;
	}
	try {
		return trimDecimals(formatUnits(weiEquivalent, 9), digits);
	} catch {
		return value;
	}
};

const formatEtherDisplay = (
	value: string,
	tokenDecimals: number,
	digits = 6,
) => {
	const weiEquivalent = toWeiEquivalent(value, tokenDecimals);
	if (weiEquivalent === null) {
		return value;
	}
	try {
		return trimDecimals(formatUnits(weiEquivalent, 18), digits);
	} catch {
		return value;
	}
};

const formatTokenDisplay = (value: string, decimals: number, digits = 6) => {
	try {
		return trimDecimals(formatUnits(BigInt(value), decimals), digits);
	} catch {
		return value;
	}
};

const stringifyRawResponse = (value: unknown) => {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "";
	}
};

const RawResponseCell = ({
	value,
	failed,
}: {
	value: unknown;
	failed: boolean;
}) => {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<number | null>(null);
	const rawText = useMemo(
		() => (value ? stringifyRawResponse(value) : ""),
		[value],
	);

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				window.clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	if (failed || !rawText) {
		return <span className="text-slate-400">—</span>;
	}

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(rawText);
			setCopied(true);
			if (timeoutRef.current) {
				window.clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = window.setTimeout(() => {
				setCopied(false);
			}, 1500);
		} catch {
			// Ignore clipboard failures.
		}
	};

	return (
		<div className="flex items-center gap-2">
			<Popover>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="text-slate-600 underline decoration-dotted underline-offset-4"
					>
						View
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="bg-white">
					<div className="max-h-72 w-80 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
						<pre className="whitespace-pre-wrap">{rawText}</pre>
					</div>
				</PopoverContent>
			</Popover>
			<button
				type="button"
				onClick={handleCopy}
				className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
};

const parseTokenInput = (value: string, decimals: number) => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	try {
		return parseUnits(trimmed, decimals).toString();
	} catch {
		return null;
	}
};

const compareNumericStrings = (
	valueA: string | null,
	valueB: string | null,
) => {
	const safeA = valueA ?? "0";
	const safeB = valueB ?? "0";
	try {
		const a = BigInt(safeA);
		const b = BigInt(safeB);
		if (a === b) {
			return 0;
		}
		return a > b ? 1 : -1;
	} catch {
		const a = Number(safeA);
		const b = Number(safeB);
		return a === b ? 0 : a > b ? 1 : -1;
	}
};

const fuzzyMatch = (query: string, target: string) => {
	if (!query) {
		return true;
	}

	let queryIndex = 0;
	for (let index = 0; index < target.length; index += 1) {
		if (target[index] === query[queryIndex]) {
			queryIndex += 1;
		}
		if (queryIndex >= query.length) {
			return true;
		}
	}

	return false;
};

const getTokenValue = (token: { symbol: string }) => token.symbol.trim();

const dedupeTokensBySymbol = <T extends { symbol: string }>(items: T[]) => {
	const seen = new Set<string>();
	return items.filter((item) => {
		const symbol = item.symbol.trim();
		if (!symbol) {
			return false;
		}
		const key = symbol.toLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
};

const TOKEN_ITEM_HEIGHT = 36;
const TOKEN_LIST_HEIGHT = 240;
const TOKEN_OVERSCAN = 6;

type VirtualTokenListProps<T> = {
	items: T[];
	emptyMessage: string;
	renderItem: (item: T) => React.ReactNode;
};

const useDebouncedValue = <T,>(value: T, delayMs = 200) => {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const handle = window.setTimeout(() => {
			setDebounced(value);
		}, delayMs);
		return () => window.clearTimeout(handle);
	}, [value, delayMs]);

	return debounced;
};

const VirtualTokenList = <T,>({
	items,
	emptyMessage,
	renderItem,
}: VirtualTokenListProps<T>) => {
	const listRef = useRef<HTMLDivElement | null>(null);
	const [scrollTop, setScrollTop] = useState(0);

	useEffect(() => {
		if (listRef.current) {
			listRef.current.scrollTop = 0;
			setScrollTop(0);
		}
	}, [items]);

	const totalHeight = items.length * TOKEN_ITEM_HEIGHT;
	const startIndex = Math.max(
		0,
		Math.floor(scrollTop / TOKEN_ITEM_HEIGHT) - TOKEN_OVERSCAN,
	);
	const endIndex = Math.min(
		items.length,
		Math.ceil((scrollTop + TOKEN_LIST_HEIGHT) / TOKEN_ITEM_HEIGHT) +
			TOKEN_OVERSCAN,
	);
	const offset = startIndex * TOKEN_ITEM_HEIGHT;
	const visibleItems = items.slice(startIndex, endIndex);

	return (
		<div
			ref={listRef}
			onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
			className="h-60 overflow-y-auto"
		>
			{items.length === 0 ? (
				<div className="flex h-full items-center justify-center px-3 py-2 text-sm text-slate-500">
					{emptyMessage}
				</div>
			) : (
				<div style={{ height: totalHeight, position: "relative" }}>
					<div style={{ transform: `translateY(${offset}px)` }}>
						{visibleItems.map(renderItem)}
					</div>
				</div>
			)}
		</div>
	);
};

function App() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const [formState, setFormState] = useState<SearchState>(search);
	const [tokenInQuery, setTokenInQuery] = useState("");
	const [tokenOutQuery, setTokenOutQuery] = useState("");
	const [isTokenInOpen, setIsTokenInOpen] = useState(false);
	const [isTokenOutOpen, setIsTokenOutOpen] = useState(false);
	const [displayTokenAmount, setDisplayTokenAmount] = useState("");
	const [isTokenAmountFocused, setIsTokenAmountFocused] = useState(false);
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
		rawResponse: false,
		calldataResponse: false,
		simulationResult: false,
	});

	useEffect(() => {
		setFormState(search);
	}, [search]);

	const tokenListQuery = useQuery({
		queryKey: ["token-list"],
		queryFn: () => getTokenList(),
		staleTime: 60 * 60 * 1000, // 1 hour
	});

	const tokens = tokenListQuery.data ?? fallbackTokenList;
	const tokensForSelect = useMemo(() => dedupeTokensBySymbol(tokens), [tokens]);
	const tokenBySymbol = useMemo(() => {
		const map = new Map<string, (typeof tokensForSelect)[number]>();
		tokensForSelect.forEach((token) => {
			map.set(token.symbol, token);
		});
		return map;
	}, [tokensForSelect]);

	const searchTokenInDecimals = tokenBySymbol.get(search.tokenIn)?.decimals ?? 18;
	const normalizedSearch = useMemo(() => {
		const parsedAmount = parseTokenInput(
			search.tokenAmount,
			searchTokenInDecimals,
		);
		return {
			...search,
			tokenAmount: parsedAmount ?? parseUnits("1", searchTokenInDecimals).toString(),
		};
	}, [search, searchTokenInDecimals]);

	const query = useQuery({
		queryKey: ["quote-comparison", normalizedSearch],
		queryFn: ({ signal }) =>
			getQuoteComparison({ data: normalizedSearch, signal } as any),
		refetchOnWindowFocus: false,
	});

	const deferredResults = useDeferredValue(query.data?.results ?? []);

	const gasPriceTokenIn = useMemo(() => {
		if (!query.data?.gasPriceTokenIn) {
			return null;
		}
		try {
			const result = new BigNumber(normalizedSearch.tokenAmount)
				.multipliedBy(BigNumber(2).pow(96))
				.dividedBy(query.data.gasPriceTokenIn);
			return result.toString();
		} catch {
			return null;
		}
	}, [normalizedSearch.tokenAmount, query.data?.gasPriceTokenIn]);

	useEffect(() => {
		if (isTokenAmountFocused) {
			return;
		}
		setDisplayTokenAmount(formState.tokenAmount);
	}, [formState.tokenAmount, isTokenAmountFocused]);
	const debouncedTokenInQuery = useDebouncedValue(tokenInQuery, 600);
	const debouncedTokenOutQuery = useDebouncedValue(tokenOutQuery, 600);

	const tokenInOptions = useMemo(() => {
		const normalized = debouncedTokenInQuery.trim().toLowerCase();
		if (!normalized) {
			return tokensForSelect;
		}

		return tokensForSelect.filter((token) => {
			const symbol = token.symbol.toLowerCase();
			const name = token.name.toLowerCase();
			return fuzzyMatch(normalized, symbol) || fuzzyMatch(normalized, name);
		});
	}, [debouncedTokenInQuery, tokensForSelect]);

	const tokenOutOptions = useMemo(() => {
		const normalized = debouncedTokenOutQuery.trim().toLowerCase();
		if (!normalized) {
			return tokensForSelect;
		}

		return tokensForSelect.filter((token) => {
			const symbol = token.symbol.toLowerCase();
			const name = token.name.toLowerCase();
			return fuzzyMatch(normalized, symbol) || fuzzyMatch(normalized, name);
		});
	}, [debouncedTokenOutQuery, tokensForSelect]);

	const tokenOutDecimals = query.data?.tokenOutDecimals ?? 18;

	const columns = useMemo(
		() => [
			columnHelper.accessor("aggregator", {
				header: "Aggregator",
				cell: (info) => (
					<span className="whitespace-nowrap">{info.getValue()}</span>
				),
				enableSorting: false,
			}),
			columnHelper.group({
				id: "outputGroup",
				header: "Output",
				columns: [
					columnHelper.accessor("amountOut", {
						header: "Amount Out",
						sortingFn: (rowA, rowB, columnId) =>
							compareNumericStrings(
								rowA.getValue<string | null>(columnId),
								rowB.getValue<string | null>(columnId),
							),
						cell: (info) => {
							const value = info.getValue();
							if (value === null || info.row.original.failed) {
								return <span className="text-slate-400">—</span>;
							}

							return (
								<Popover>
									<PopoverTrigger asChild>
										<button
											type="button"
											className="font-mono text-left underline decoration-dotted decoration-slate-400 underline-offset-4 focus:outline-none"
										>
											{formatTokenDisplay(value, tokenOutDecimals)}
										</button>
									</PopoverTrigger>
									<PopoverContent align="start" className="bg-white">
										<div className="space-y-2 *:**:text-black">
											<div className="flex items-center justify-between gap-3">
												<span className="text-white/60">Wei</span>
												<span className="font-mono text-white">
													{formatWeiDisplay(value, tokenOutDecimals)}
												</span>
											</div>
											<div className="flex items-center justify-between gap-3">
												<span className="text-white/60">Gwei</span>
												<span className="font-mono text-white">
													{formatGweiDisplay(value, tokenOutDecimals)}
												</span>
											</div>
											<div className="flex items-center justify-between gap-3">
												<span className="text-white/60">Ether</span>
												<span className="font-mono text-white">
													{formatEtherDisplay(value, tokenOutDecimals)}
												</span>
											</div>
										</div>
									</PopoverContent>
								</Popover>
							);
						},
					}),
					columnHelper.display({
						id: "simulationOutputTokenAmount",
						header: "Sim Output",
						enableSorting: true,
						sortingFn: (rowA, rowB) =>
							compareNumericStrings(
								rowA.original.simulationResult?.outputTokenAmount ?? null,
								rowB.original.simulationResult?.outputTokenAmount ?? null,
							),
						cell: (info) => {
							if (info.row.original.failed) {
								return <span className="text-slate-400">—</span>;
							}

							const outputTokenAmount =
								info.row.original.simulationResult?.outputTokenAmount;
							if (!outputTokenAmount) {
								return <span className="text-slate-400">—</span>;
							}

							return (
								<span className="font-mono">
									{formatTokenDisplay(outputTokenAmount, tokenOutDecimals)}
								</span>
							);
						},
					}),
					columnHelper.display({
						id: "outputDiff",
						header: "Diff",
						enableSorting: true,
						sortingFn: (rowA, rowB) => {
							try {
								const amountOutA = rowA.original.amountOut;
								const simOutputA =
									rowA.original.simulationResult?.outputTokenAmount;
								const amountOutB = rowB.original.amountOut;
								const simOutputB =
									rowB.original.simulationResult?.outputTokenAmount;

								const diffA =
									amountOutA && simOutputA
										? (BigInt(simOutputA) - BigInt(amountOutA)).toString()
										: null;
								const diffB =
									amountOutB && simOutputB
										? (BigInt(simOutputB) - BigInt(amountOutB)).toString()
										: null;

								return compareNumericStrings(diffA, diffB);
							} catch {
								return 0;
							}
						},
						cell: (info) => {
							if (info.row.original.failed) {
								return <span className="text-slate-400">—</span>;
							}

							const amountOut = info.row.original.amountOut;
							const simOutput =
								info.row.original.simulationResult?.outputTokenAmount;

							if (!amountOut || !simOutput) {
								return <span className="text-slate-400">—</span>;
							}

							try {
								const diff = BigInt(simOutput) - BigInt(amountOut);
								const absDiff = diff < 0n ? -diff : diff;
								const sign = diff > 0n ? "+" : diff < 0n ? "-" : "";
								const diffColor =
									diff > 0n
										? "text-emerald-600"
										: diff < 0n
											? "text-red-600"
											: "text-slate-500";

								return (
									<span className={`font-mono ${diffColor}`}>
										{sign}
										{formatTokenDisplay(absDiff.toString(), tokenOutDecimals)}
									</span>
								);
							} catch {
								return <span className="text-slate-400">—</span>;
							}
						},
					}),
				],
			}),
			columnHelper.group({
				id: "gasGroup",
				header: "Gas",
				columns: [
					columnHelper.accessor("gasUsed", {
						header: "Gas",
						cell: (info) => {
							const value = info.getValue();
							if (value === null || info.row.original.failed) {
								return <span className="text-slate-400">—</span>;
							}
							return (
								<span className="font-mono">
									{new Intl.NumberFormat("en-US").format(value)}
								</span>
							);
						},
					}),
					columnHelper.display({
						id: "simulationGasTotal",
						header: "Sim Gas",
						enableSorting: true,
						sortingFn: (rowA, rowB) => {
							const simulationA = rowA.original.simulationResult;
							const simulationB = rowB.original.simulationResult;
							const totalA = simulationA
								? simulationA.approveTxGasUsed + simulationA.swapTxGasUsed
								: null;
							const totalB = simulationB
								? simulationB.approveTxGasUsed + simulationB.swapTxGasUsed
								: null;

							return compareNumericStrings(
								Number.isFinite(totalA) ? String(totalA) : null,
								Number.isFinite(totalB) ? String(totalB) : null,
							);
						},
						cell: (info) => {
							if (info.row.original.failed) {
								return <span className="text-slate-400">—</span>;
							}

							const simulation = info.row.original.simulationResult;
							if (!simulation) {
								return <span className="text-slate-400">—</span>;
							}

							const totalGas =
								simulation.approveTxGasUsed + simulation.swapTxGasUsed;
							if (!Number.isFinite(totalGas)) {
								return <span className="text-slate-400">—</span>;
							}

							return (
								<span className="font-mono">
									{new Intl.NumberFormat("en-US").format(totalGas)}
								</span>
							);
						},
					}),
					columnHelper.display({
						id: "gasDiff",
						header: "Diff",
						enableSorting: true,
						sortingFn: (rowA, rowB) => {
							const quoteGasA = rowA.original.gasUsed;
							const simulationA = rowA.original.simulationResult;
							const quoteGasB = rowB.original.gasUsed;
							const simulationB = rowB.original.simulationResult;

							const simGasA = simulationA
								? simulationA.approveTxGasUsed + simulationA.swapTxGasUsed
								: null;
							const simGasB = simulationB
								? simulationB.approveTxGasUsed + simulationB.swapTxGasUsed
								: null;

							const diffA =
								quoteGasA !== null &&
								quoteGasA !== undefined &&
								Number.isFinite(simGasA)
									? String((simGasA as number) - quoteGasA)
									: null;
							const diffB =
								quoteGasB !== null &&
								quoteGasB !== undefined &&
								Number.isFinite(simGasB)
									? String((simGasB as number) - quoteGasB)
									: null;

							return compareNumericStrings(diffA, diffB);
						},
						cell: (info) => {
							if (info.row.original.failed) {
								return <span className="text-slate-400">—</span>;
							}

							const quoteGas = info.row.original.gasUsed;
							const simulation = info.row.original.simulationResult;
							if (quoteGas === null || !simulation) {
								return <span className="text-slate-400">—</span>;
							}

							const simGas =
								simulation.approveTxGasUsed + simulation.swapTxGasUsed;
							if (!Number.isFinite(simGas)) {
								return <span className="text-slate-400">—</span>;
							}
							const diff = simGas - quoteGas;
							if (!Number.isFinite(diff)) {
								return <span className="text-slate-400">—</span>;
							}
							const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
							const diffColor =
								diff > 0
									? "text-red-600"
									: diff < 0
										? "text-emerald-600"
										: "text-slate-500";

							return (
								<span className={`font-mono ${diffColor}`}>
									{sign}
									{new Intl.NumberFormat("en-US").format(Math.abs(diff))}
								</span>
							);
						},
					}),
				],
			}),
			columnHelper.accessor("sources", {
				header: "Sources",
				sortingFn: (rowA, rowB) =>
					(rowA.original.sources?.length ?? 0) -
					(rowB.original.sources?.length ?? 0),
				cell: (info) => {
					const value = info.getValue();
					if (!value || value.length === 0 || info.row.original.failed) {
						return <span className="text-slate-400">—</span>;
					}
					return (
						<div className="flex flex-wrap gap-1">
							{value.map((source) => (
								<Badge key={source} variant="outline">
									{source}
								</Badge>
							))}
						</div>
					);
				},
			}),
			columnHelper.accessor("rawResponse", {
				header: "Raw",
				enableSorting: false,
				cell: (info) => (
					<RawResponseCell
						value={info.getValue()}
						failed={info.row.original.failed ?? false}
					/>
				),
			}),
			columnHelper.accessor("calldataResponse", {
				header: "Calldata",
				enableSorting: false,
				cell: (info) => (
					<RawResponseCell
						value={info.getValue()}
						failed={info.row.original.failed ?? false}
					/>
				),
			}),
			columnHelper.accessor("simulationResult", {
				header: "Simulation",
				enableSorting: false,
				cell: (info) => (
					<RawResponseCell
						value={info.getValue()}
						failed={info.row.original.failed ?? false}
					/>
				),
			}),
			columnHelper.accessor("netOutput", {
				header: "Net",
				cell: (info) => {
					if (info.row.original.failed) {
						return <span className="text-slate-400">—</span>;
					}
					const rawValue = Math.max(0, Math.round(info.getValue()));
					const rawString = rawValue.toString();
					return (
						<Popover>
							<PopoverTrigger asChild>
								<button
									type="button"
									className="font-mono text-left underline decoration-dotted decoration-slate-400 underline-offset-4 focus:outline-none"
								>
									{formatTokenDisplay(rawString, tokenOutDecimals)}
								</button>
							</PopoverTrigger>
							<PopoverContent align="start" className="bg-white">
								<div className="space-y-2 *:**:text-black">
									<div className="flex items-center justify-between gap-3">
										<span className="text-white/60">Wei</span>
										<span className="font-mono text-white">
											{formatWeiDisplay(rawString, tokenOutDecimals)}
										</span>
									</div>
									<div className="flex items-center justify-between gap-3">
										<span className="text-white/60">Gwei</span>
										<span className="font-mono text-white">
											{formatGweiDisplay(rawString, tokenOutDecimals)}
										</span>
									</div>
									<div className="flex items-center justify-between gap-3">
										<span className="text-white/60">Ether</span>
										<span className="font-mono text-white">
											{formatEtherDisplay(rawString, tokenOutDecimals)}
										</span>
									</div>
								</div>
							</PopoverContent>
						</Popover>
					);
				},
			}),
			columnHelper.accessor("distance", {
				header: "Distance",
				cell: (info) =>
					info.row.original.failed ? (
						<span className="text-slate-400">—</span>
					) : (
						<span className="font-mono">{`${formatDecimal(info.getValue())}%`}</span>
					),
			}),
			columnHelper.accessor("score", {
				header: "Score",
				cell: (info) =>
					info.row.original.failed ? (
						<span className="text-slate-400">—</span>
					) : (
						<span className="font-mono">{formatDecimal(info.getValue())}</span>
					),
			}),
		],
		[tokenOutDecimals],
	);

	const table = useReactTable({
		data: deferredResults,
		columns,
		state: {
			sorting,
			columnVisibility,
		},
		onSortingChange: setSorting,
		onColumnVisibilityChange: setColumnVisibility,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const nextSearch = {
			...formState,
			tokenAmount: displayTokenAmount.trim() || DEFAULT_TOKEN_AMOUNT,
		};

		const isSameSearch =
			search.tokenIn === nextSearch.tokenIn &&
			search.tokenOut === nextSearch.tokenOut &&
			search.tokenAmount === nextSearch.tokenAmount &&
			search.order === nextSearch.order &&
			search.disablePrice === nextSearch.disablePrice;

		if (isSameSearch) {
			void query.refetch();
			return;
		}

		navigate({ search: nextSearch });
	};

	if (tokenListQuery.isLoading && !tokenListQuery.data) {
		return (
			<div className="min-h-screen bg-white text-slate-900">
				<div className="mx-auto flex max-w-6xl items-center justify-center px-6 pb-16 pt-14">
					<div className="rounded-md border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600">
						Loading token list...
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-white text-slate-900">
			<div className="relative overflow-hidden">
				<div className="hidden" />
				<div className="hidden" />
				<div className="mx-auto flex max-w-8xl flex-col gap-10 px-6 pb-16 pt-14">
					<form
						onSubmit={handleSubmit}
						className="grid gap-4 rounded-md border border-slate-200 bg-white p-6"
					>
						<div className="grid gap-4 md:grid-cols-5">
							<label className="flex flex-col gap-2 text-sm text-slate-600">
								Token In
								<Select
									value={formState.tokenIn}
									onOpenChange={setIsTokenInOpen}
									onValueChange={(value) => {
										setFormState((prev) => ({
											...prev,
											tokenIn: value,
										}));
										setTokenInQuery("");
									}}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select token">
											{tokenBySymbol.get(formState.tokenIn) ? (
												<>
													<span className="font-mono">
														{tokenBySymbol.get(formState.tokenIn)?.symbol}
													</span>
													<span className="text-slate-500">
														{tokenBySymbol.get(formState.tokenIn)?.name}
													</span>
												</>
											) : null}
										</SelectValue>
									</SelectTrigger>
									<SelectContent
										position="popper"
										align="start"
										className="h-80 w-(--radix-select-trigger-width) overflow-hidden"
									>
										{isTokenInOpen && (
											<>
												<div className="sticky top-0 z-10 bg-white p-2">
													<input
														value={tokenInQuery}
														onChange={(event) =>
															setTokenInQuery(event.target.value)
														}
														onKeyDown={(event) => event.stopPropagation()}
														placeholder="Search token"
														className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
													/>
												</div>
												<VirtualTokenList
													items={tokenInOptions}
													emptyMessage="No tokens found"
													renderItem={(token) => (
														<SelectItem
															key={token.symbol}
															value={getTokenValue(token)}
															className="h-9 whitespace-nowrap"
														>
															<span className="font-mono shrink-0">
																{token.symbol}
															</span>
															<span className="text-slate-500 truncate">
																{token.name}
															</span>
														</SelectItem>
													)}
												/>
											</>
										)}
									</SelectContent>
								</Select>
							</label>
							<label className="flex flex-col gap-2 text-sm text-slate-600">
								Token Out
								<Select
									value={formState.tokenOut}
									onOpenChange={setIsTokenOutOpen}
									onValueChange={(value) => {
										setFormState((prev) => ({
											...prev,
											tokenOut: value,
										}));
										setTokenOutQuery("");
									}}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select token">
											{tokenBySymbol.get(formState.tokenOut) ? (
												<>
													<span className="font-mono">
														{tokenBySymbol.get(formState.tokenOut)?.symbol}
													</span>
													<span className="text-slate-500">
														{tokenBySymbol.get(formState.tokenOut)?.name}
													</span>
												</>
											) : null}
										</SelectValue>
									</SelectTrigger>
									<SelectContent
										position="popper"
										align="start"
										className="h-80 w-(--radix-select-trigger-width) overflow-hidden"
									>
										{isTokenOutOpen && (
											<>
												<div className="sticky top-0 z-10 bg-white p-2">
													<input
														value={tokenOutQuery}
														onChange={(event) =>
															setTokenOutQuery(event.target.value)
														}
														onKeyDown={(event) => event.stopPropagation()}
														placeholder="Search token"
														className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
													/>
												</div>
												<VirtualTokenList
													items={tokenOutOptions}
													emptyMessage="No tokens found"
													renderItem={(token) => (
														<SelectItem
															key={token.symbol}
															value={getTokenValue(token)}
															className="h-9 whitespace-nowrap"
														>
															<span className="font-mono shrink-0">
																{token.symbol}
															</span>
															<span className="text-slate-500 truncate">
																{token.name}
															</span>
														</SelectItem>
													)}
												/>
											</>
										)}
									</SelectContent>
								</Select>
							</label>
							<label className="flex flex-col gap-2 text-sm text-slate-600">
								Amount In
								<input
									value={displayTokenAmount}
									onFocus={() => setIsTokenAmountFocused(true)}
									onBlur={() => setIsTokenAmountFocused(false)}
									onChange={(event) => {
										const nextValue = event.target.value;
										setDisplayTokenAmount(nextValue);
										setFormState((prev) => ({
											...prev,
											tokenAmount: nextValue,
										}));
									}}
									className="rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-mono text-slate-900 outline-none focus:border-slate-400"
								/>
							</label>
							<label className="flex items-center gap-2">
								<Checkbox
									checked={formState.disablePrice === "true"}
									onCheckedChange={(checked) =>
										setFormState((prev) => ({
											...prev,
											disablePrice: checked ? "true" : "false",
										}))
									}
								/>
								<span>Disable price</span>
							</label>
						</div>
						<div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
							<button
								type="submit"
								disabled={query.isFetching}
								className="rounded-md bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
							>
								Refresh quotes
							</button>
							<span className="font-mono">
								Gas price in token in: {gasPriceTokenIn ?? 0}
							</span>
							{query.isFetching && (
								<span className="inline-flex items-center gap-2 text-slate-500">
									<span className="h-2 w-2 animate-pulse rounded-full bg-slate-500" />
									Fetching routes...
								</span>
							)}
						</div>
					</form>

					<div className="rounded-md border border-slate-200 bg-white px-6">
						<Accordion type="single" collapsible>
							<AccordionItem value="table-settings" className="border-b-0">
								<AccordionTrigger className="py-4 text-slate-900">
									Table settings
								</AccordionTrigger>
								<AccordionContent className="pb-4">
									<div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
										<label className="flex items-center gap-2">
											<Checkbox
												checked={table.getColumn("rawResponse")?.getIsVisible()}
												onCheckedChange={(checked) =>
													setColumnVisibility((prev) => ({
														...prev,
														rawResponse: checked === true,
													}))
												}
											/>
											<span>Show Raw column</span>
										</label>
										<label className="flex items-center gap-2">
											<Checkbox
												checked={table
													.getColumn("calldataResponse")
													?.getIsVisible()}
												onCheckedChange={(checked) =>
													setColumnVisibility((prev) => ({
														...prev,
														calldataResponse: checked === true,
													}))
												}
											/>
											<span>Show Calldata column</span>
										</label>
										<label className="flex items-center gap-2">
											<Checkbox
												checked={table
													.getColumn("simulationResult")
													?.getIsVisible()}
												onCheckedChange={(checked) =>
													setColumnVisibility((prev) => ({
														...prev,
														simulationResult: checked === true,
													}))
												}
											/>
											<span>Show Simulation column</span>
										</label>
									</div>
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</div>

					<div className="rounded-md border border-slate-200 bg-white p-6">
						<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
							<div className="min-w-0">
								<p className="text-sm uppercase tracking-[0.3em] text-slate-400">
									Results
								</p>
								<h2
									className="wrap-break-word text-2xl font-semibold"
									style={{
										fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
									}}
								>
									{search.tokenIn} to {search.tokenOut} for{" "}
									<span className="break-all font-mono">
										{search.tokenAmount}
									</span>
								</h2>
							</div>
							<div className="text-right text-sm text-slate-600">
								<p>Order: {search.order}</p>
								<p>Disable price: {search.disablePrice}</p>
							</div>
						</div>

						{query.data?.status === "error" && (
							<div
								role="alert"
								className="overflow-x-auto max-w-full mt-6 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
							>
								<span className="mt-0.5 inline-flex h-2 w-2 rounded-full bg-red-500" />
								<div>
									<p className="font-semibold">Quote request failed</p>
									<span className="w-full text-red-700/80 text-wrap wrap-break-word">
										{String(query.data?.error)}
									</span>
								</div>
							</div>
						)}

						{query.data?.status !== "error" && (
							<div className="mt-6 overflow-x-auto rounded-md border border-slate-200">
								{query.isFetching && (
									<div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
										<span className="h-2 w-2 animate-pulse rounded-full bg-slate-500" />
										Loading quotes...
									</div>
								)}
								<table
									className="min-w-full border-separate border-spacing-0 text-sm"
								>
									<thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
										{table.getHeaderGroups().map((headerGroup) => (
											<tr key={headerGroup.id}>
												{headerGroup.headers.map((header) => (
													<th
														key={header.id}
														colSpan={header.colSpan}
														className={`border-b border-slate-200 px-4 py-3 font-semibold ${
															header.subHeaders.length > 0
																? "bg-slate-100 text-center"
																: "text-left"
														}`}
													>
														{header.isPlaceholder ? null : header.column.getCanSort() ? (
															<button
																type="button"
																onClick={header.column.getToggleSortingHandler()}
																className="inline-flex items-center gap-2"
															>
																{flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
																<span className="text-slate-400">
																	{header.column.getIsSorted() === "asc"
																		? "▲"
																		: header.column.getIsSorted() === "desc"
																			? "▼"
																			: "↕"}
																</span>
															</button>
														) : (
															flexRender(
																header.column.columnDef.header,
																header.getContext(),
															)
														)}
													</th>
												))}
											</tr>
										))}
									</thead>
									<tbody className="text-slate-700">
										{table.getRowModel().rows.map((row) => (
											<tr key={row.id} className="transition hover:bg-slate-50">
												{row.getVisibleCells().map((cell) => (
													<td
														key={cell.id}
														className="border-b border-slate-100 px-4 py-3 align-top"
													>
														{flexRender(
															cell.column.columnDef.cell,
															cell.getContext(),
														)}
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
