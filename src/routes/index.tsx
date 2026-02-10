import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { formatEther, formatGwei, formatUnits } from 'viem'
import {
  getQuoteComparison,
  fallbackTokenList,
  getTokenList,
  type OrderBy,
  type QuoteRow,
} from '../data/quote-compare'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SearchState = {
  tokenIn: string
  tokenOut: string
  tokenAmount: string
  order: OrderBy
  disablePrice: 'true' | 'false'
}

export const Route = createFileRoute('/')({
  validateSearch: (search): SearchState => {
    const stripQuotes = (value: string) => value.replace(/^\"|\"$/g, '')
    const coerceString = (value: unknown) => {
      if (typeof value === 'string') {
        return value
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
      }
      return ''
    }
    const cleanValue = (value: unknown) =>
      stripQuotes(coerceString(value).trim())

    const tokenInValue = cleanValue(search.tokenIn)
    const tokenOutValue = cleanValue(search.tokenOut)
    const tokenAmountValue = cleanValue(search.tokenAmount)
    const orderValue = cleanValue(search.order)
    const disablePriceValue = cleanValue(search.disablePrice)

    const tokenIn = tokenInValue.length > 0 ? tokenInValue : 'WETH'
    const tokenOut = tokenOutValue.length > 0 ? tokenOutValue : 'WBTC'
    const tokenAmount =
      tokenAmountValue.length > 0 ? tokenAmountValue : '1000000000000000000'
    const order =
      orderValue === 'score' || orderValue === 'net' || orderValue === 'output'
        ? orderValue
        : 'net'
    const disablePrice = disablePriceValue === 'true' ? 'true' : 'false'

    return { tokenIn, tokenOut, tokenAmount, order, disablePrice }
  },
  component: App,
})

const columnHelper = createColumnHelper<QuoteRow>()

const formatDecimal = (value: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)

const trimDecimals = (value: string, digits = 6) => {
  const [whole, fractional] = value.split('.')
  if (!fractional) {
    return value
  }

  return `${whole}.${fractional.slice(0, digits)}`
}

const formatEtherDisplay = (value: string, digits = 6) => {
  try {
    return trimDecimals(formatEther(BigInt(value)), digits)
  } catch {
    return value
  }
}

const formatGweiDisplay = (value: string, digits = 6) => {
  try {
    return trimDecimals(formatGwei(BigInt(value)), digits)
  } catch {
    return value
  }
}

const formatTokenDisplay = (value: string, decimals: number, digits = 6) => {
  try {
    return trimDecimals(formatUnits(BigInt(value), decimals), digits)
  } catch {
    return value
  }
}

const compareNumericStrings = (valueA: string, valueB: string) => {
  try {
    const a = BigInt(valueA)
    const b = BigInt(valueB)
    if (a === b) {
      return 0
    }
    return a > b ? 1 : -1
  } catch {
    const a = Number(valueA)
    const b = Number(valueB)
    return a === b ? 0 : a > b ? 1 : -1
  }
}

const fuzzyMatch = (query: string, target: string) => {
  if (!query) {
    return true
  }

  let queryIndex = 0
  for (let index = 0; index < target.length; index += 1) {
    if (target[index] === query[queryIndex]) {
      queryIndex += 1
    }
    if (queryIndex >= query.length) {
      return true
    }
  }

  return false
}

const getTokenValue = (token: { symbol: string }) => token.symbol.trim()

const dedupeTokensBySymbol = <T extends { symbol: string }>(items: T[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const symbol = item.symbol.trim()
    if (!symbol) {
      return false
    }
    const key = symbol.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const TOKEN_ITEM_HEIGHT = 36
const TOKEN_LIST_HEIGHT = 240
const TOKEN_OVERSCAN = 6

type VirtualTokenListProps<T> = {
  items: T[]
  emptyMessage: string
  renderItem: (item: T) => React.ReactNode
}

const useDebouncedValue = <T,>(value: T, delayMs = 200) => {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebounced(value)
    }, delayMs)
    return () => window.clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}

const VirtualTokenList = <T,>({
  items,
  emptyMessage,
  renderItem,
}: VirtualTokenListProps<T>) => {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0
      setScrollTop(0)
    }
  }, [items])

  const totalHeight = items.length * TOKEN_ITEM_HEIGHT
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / TOKEN_ITEM_HEIGHT) - TOKEN_OVERSCAN,
  )
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + TOKEN_LIST_HEIGHT) / TOKEN_ITEM_HEIGHT) +
      TOKEN_OVERSCAN,
  )
  const offset = startIndex * TOKEN_ITEM_HEIGHT
  const visibleItems = items.slice(startIndex, endIndex)

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
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offset}px)` }}>
            {visibleItems.map(renderItem)}
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [formState, setFormState] = useState<SearchState>(search)
  const [tokenInQuery, setTokenInQuery] = useState('')
  const [tokenOutQuery, setTokenOutQuery] = useState('')
  const [isTokenInOpen, setIsTokenInOpen] = useState(false)
  const [isTokenOutOpen, setIsTokenOutOpen] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  useEffect(() => {
    setFormState(search)
  }, [search])

  const query = useQuery({
    queryKey: ['quote-comparison', search],
    queryFn: () => getQuoteComparison({ data: search }),
    placeholderData: keepPreviousData,
  })

  const tokenListQuery = useQuery({
    queryKey: ['token-list'],
    queryFn: () => getTokenList(),
  })

  console.log("formState.tokenIn", formState.tokenIn)

  const tokens = tokenListQuery.data ?? fallbackTokenList
  const tokensForSelect = useMemo(
    () => dedupeTokensBySymbol(tokens),
    [tokens],
  )
  const tokenBySymbol = useMemo(() => {
    const map = new Map<string, (typeof tokensForSelect)[number]>()
    tokensForSelect.forEach((token) => {
      map.set(token.symbol, token)
    })
    return map
  }, [tokensForSelect])
  const debouncedTokenInQuery = useDebouncedValue(tokenInQuery, 600)
  const debouncedTokenOutQuery = useDebouncedValue(tokenOutQuery, 600)

  const tokenInOptions = useMemo(() => {
    const normalized = debouncedTokenInQuery.trim().toLowerCase()
    if (!normalized) {
      return tokensForSelect
    }

    return tokensForSelect.filter((token) => {
      const symbol = token.symbol.toLowerCase()
      const name = token.name.toLowerCase()
      return fuzzyMatch(normalized, symbol) || fuzzyMatch(normalized, name)
    })
  }, [debouncedTokenInQuery, tokensForSelect])

  const tokenOutOptions = useMemo(() => {
    const normalized = debouncedTokenOutQuery.trim().toLowerCase()
    if (!normalized) {
      return tokensForSelect
    }

    return tokensForSelect.filter((token) => {
      const symbol = token.symbol.toLowerCase()
      const name = token.name.toLowerCase()
      return fuzzyMatch(normalized, symbol) || fuzzyMatch(normalized, name)
    })
  }, [debouncedTokenOutQuery, tokensForSelect])

  const tokenOutDecimals = query.data?.tokenOutDecimals ?? 18

  const columns = useMemo(
    () => [
      columnHelper.accessor('aggregator', {
        header: 'Aggregator',
        cell: (info) => info.getValue(),
        enableSorting: false,
      }),
      columnHelper.accessor('amountOut', {
        header: 'Amount Out',
        sortingFn: (rowA, rowB, columnId) =>
          compareNumericStrings(
            rowA.getValue<string>(columnId),
            rowB.getValue<string>(columnId),
          ),
        cell: (info) => (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="font-mono text-left underline decoration-dotted decoration-slate-400 underline-offset-4 focus:outline-none"
              >
                {formatTokenDisplay(info.getValue(), tokenOutDecimals)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className='bg-white'>
              <div className="space-y-2 *:**:text-black">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/60">Wei</span>
                  <span className="font-mono text-white">
                    {info.getValue()}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/60">Gwei</span>
                  <span className="font-mono text-white">
                    {formatGweiDisplay(info.getValue())}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/60">Ether</span>
                  <span className="font-mono text-white">
                    {formatEtherDisplay(info.getValue())}
                  </span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ),
      }),
      columnHelper.accessor('gasUsed', {
        header: 'Gas',
        cell: (info) => (
          <span className="font-mono">
            {new Intl.NumberFormat('en-US').format(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('sources', {
        header: 'Sources',
        sortingFn: (rowA, rowB) =>
          rowA.original.sources.length - rowB.original.sources.length,
        cell: (info) => info.getValue().join(', '),
      }),
      columnHelper.accessor('netOutput', {
        header: 'Net',
        cell: (info) => {
          const rawValue = Math.max(0, Math.round(info.getValue()))
          const rawString = rawValue.toString()
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
              <PopoverContent align="start" className='bg-white'>
                <div className="space-y-2 *:**:text-black">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/60">Wei</span>
                    <span className="font-mono text-white">{rawString}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/60">Gwei</span>
                    <span className="font-mono text-white">
                      {formatGweiDisplay(rawString)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/60">Ether</span>
                    <span className="font-mono text-white">
                      {formatEtherDisplay(rawString)}
                    </span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )
        },
      }),
      columnHelper.accessor('distance', {
        header: 'Distance',
        cell: (info) => (
          <span className="font-mono">{`${formatDecimal(info.getValue())}%`}</span>
        ),
      }),
      columnHelper.accessor('score', {
        header: 'Score',
        cell: (info) => (
          <span className="font-mono">{formatDecimal(info.getValue())}</span>
        ),
      }),
    ],
    [tokenOutDecimals],
  )

  const table = useReactTable({
    data: query.data?.results ?? [],
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const isSameSearch =
      search.tokenIn === formState.tokenIn &&
      search.tokenOut === formState.tokenOut &&
      search.tokenAmount === formState.tokenAmount &&
      search.order === formState.order &&
      search.disablePrice === formState.disablePrice

    if (isSameSearch) {
      void query.refetch()
      return
    }

    navigate({ search: formState })
  }

  if (tokenListQuery.isLoading && !tokenListQuery.data) {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-center px-6 pb-16 pt-14">
          <div className="rounded-md border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600">
            Loading token list...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="relative overflow-hidden">
        <div className="hidden" />
        <div className="hidden" />
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 pb-16 pt-14">
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
                    }))
                    setTokenInQuery('')
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
                    className="h-80 w-[var(--radix-select-trigger-width)] overflow-hidden"
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
                              <span className="font-mono shrink-0">{token.symbol}</span>
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
                    }))
                    setTokenOutQuery('')
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
                    className="h-80 w-[var(--radix-select-trigger-width)] overflow-hidden"
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
                              <span className="font-mono shrink-0">{token.symbol}</span>
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
                  value={formState.tokenAmount}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      tokenAmount: event.target.value,
                    }))
                  }
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-base font-mono text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={formState.disablePrice === 'true'}
                  onCheckedChange={(checked) =>
                    setFormState((prev) => ({
                      ...prev,
                      disablePrice: checked ? 'true' : 'false',
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
                Gas price in token in: {query.data?.gasPriceTokenIn ?? 0}
              </span>
              {query.isFetching && (
                <span className="inline-flex items-center gap-2 text-slate-500">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-slate-500" />
                  Fetching routes...
                </span>
              )}
            </div>
          </form>

          <div className="rounded-md border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
                  Results
                </p>
                <h2
                  className="text-2xl font-semibold"
                  style={{ fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' }}
                >
                  {search.tokenIn} to {search.tokenOut} for{' '}
                  <span className="font-mono">{search.tokenAmount}</span>
                </h2>
              </div>
              <div className="text-right text-sm text-slate-600">
                <p>Order: {search.order}</p>
                <p>Disable price: {search.disablePrice}</p>
              </div>
            </div>

            {query.error && (
              <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Failed to load quotes. {String(query.error)}
              </div>
            )}

            <div className="mt-6 overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="border-b border-slate-200 px-4 py-3 text-left font-semibold"
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
                                {header.column.getIsSorted() === 'asc'
                                  ? '▲'
                                  : header.column.getIsSorted() === 'desc'
                                    ? '▼'
                                    : '↕'}
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
                    <tr
                      key={row.id}
                      className="transition hover:bg-slate-50"
                    >
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
          </div>
        </div>
      </div>
    </div>
  )
}
