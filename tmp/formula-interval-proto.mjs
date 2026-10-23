// 原型验证：为 effectFormula 增加"区间求值"是否可行、是否可证明（enclosure）。
// 只在 tmp/ 内运行，不修改仓库源码。
// 思路：把现有公式语言（+ - * / floor ceil round min max clamp 与变量 x/常量参数）
// 解析成 AST，并做保守区间算术：对任意 x ∈ [xMin, xMax]，表达式的真实值必落在返回区间内。

const FUNCTIONS = {
    floor: { arity: 1, fn: Math.floor, interval: ([value]) => ({ min: Math.floor(value.min), max: Math.floor(value.max) }) },
    ceil: { arity: 1, fn: Math.ceil, interval: ([value]) => ({ min: Math.ceil(value.min), max: Math.ceil(value.max) }) },
    round: { arity: 1, fn: Math.round, interval: ([value]) => ({ min: Math.round(value.min), max: Math.round(value.max) }) },
    min: { minArity: 1, fn: (...values) => Math.min(...values), interval: intervals => ({ min: Math.min(...intervals.map(i => i.min)), max: Math.min(...intervals.map(i => i.max)) }) },
    max: { minArity: 1, fn: (...values) => Math.max(...values), interval: intervals => ({ min: Math.max(...intervals.map(i => i.min)), max: Math.max(...intervals.map(i => i.max)) }) },
    clamp: {
        arity: 3,
        fn: (value, lower, upper) => Math.max(lower, Math.min(upper, value)),
        interval: ([value, lower, upper]) => {
            const candidates = []
            for (const v of [value.min, value.max]) for (const l of [lower.min, lower.max]) for (const u of [upper.min, upper.max]) {
                candidates.push(Math.max(l, Math.min(u, v)))
            }
            return { min: Math.min(...candidates), max: Math.max(...candidates) }
        },
    },
}

function tokenize(expression) {
    const tokens = []
    let index = 0
    while (index < expression.length) {
        const char = expression[index]
        if (/\s/.test(char)) { index += 1; continue }
        if (/[0-9.]/.test(char)) {
            const start = index
            index += 1
            while (index < expression.length && /[0-9.]/.test(expression[index])) index += 1
            const raw = expression.slice(start, index)
            if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw new Error(`Invalid number: ${raw}`)
            tokens.push({ type: "number", value: Number(raw) })
            continue
        }
        if (/[A-Za-z_]/.test(char)) {
            const start = index
            index += 1
            while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index])) index += 1
            tokens.push({ type: "identifier", value: expression.slice(start, index) })
            continue
        }
        if ("+-*/(),;".includes(char)) { tokens.push({ type: char, value: char }); index += 1; continue }
        throw new Error(`Unsupported character: ${char}`)
    }
    tokens.push({ type: "eof" })
    return tokens
}

function parseExpressionToAst(expression) {
    const tokens = tokenize(expression)
    let index = 0
    const current = () => tokens[index]
    const match = type => { if (current().type !== type) return false; index += 1; return true }
    const expect = type => { if (!match(type)) throw new Error(`Expected ${type}, got ${current().type}`) }
    function parseSum() {
        let node = parseTerm()
        while (current().type === "+" || current().type === "-") {
            const op = current().type; index += 1
            node = { type: "binary", op, left: node, right: parseTerm() }
        }
        return node
    }
    function parseTerm() {
        let node = parseUnary()
        while (current().type === "*" || current().type === "/") {
            const op = current().type; index += 1
            node = { type: "binary", op, left: node, right: parseUnary() }
        }
        return node
    }
    function parseUnary() {
        if (match("+")) return parseUnary()
        if (match("-")) return { type: "negate", arg: parseUnary() }
        return parsePrimary()
    }
    function parsePrimary() {
        const token = current()
        if (token.type === "number") { index += 1; return { type: "number", value: token.value } }
        if (token.type === "identifier") {
            index += 1
            if (match("(")) {
                const args = []
                if (!match(")")) {
                    do { args.push(parseSum()) } while (match(","))
                    expect(")")
                }
                return { type: "call", name: token.value, args }
            }
            return { type: "variable", name: token.value }
        }
        if (match("(")) { const node = parseSum(); expect(")"); return node }
        throw new Error(`Unexpected token: ${token.type}`)
    }
    const ast = parseSum()
    expect("eof")
    return ast
}

function intervalEval(node, variables) {
    if (node.type === "number") return { min: node.value, max: node.value }
    if (node.type === "variable") {
        const value = variables[node.name]
        if (value && typeof value === "object") return value
        if (Number.isFinite(Number(value))) return { min: Number(value), max: Number(value) }
        throw new Error(`Unknown variable: ${node.name}`)
    }
    if (node.type === "negate") {
        const arg = intervalEval(node.arg, variables)
        return { min: -arg.max, max: -arg.min }
    }
    if (node.type === "binary") {
        const left = intervalEval(node.left, variables)
        const right = intervalEval(node.right, variables)
        if (node.op === "+") return { min: left.min + right.min, max: left.max + right.max }
        if (node.op === "-") return { min: left.min - right.max, max: left.max - right.min }
        if (node.op === "*") {
            const products = [left.min * right.min, left.min * right.max, left.max * right.min, left.max * right.max]
            return { min: Math.min(...products), max: Math.max(...products) }
        }
        if (node.op === "/") {
            if (right.min <= 0 && right.max >= 0) throw new Error("Interval division crosses zero")
            const quotients = [left.min / right.min, left.min / right.max, left.max / right.min, left.max / right.max]
            return { min: Math.min(...quotients), max: Math.max(...quotients) }
        }
        throw new Error(`Unsupported binary op: ${node.op}`)
    }
    if (node.type === "call") {
        const fn = FUNCTIONS[node.name]
        if (!fn) throw new Error(`Unsupported function: ${node.name}`)
        const intervals = node.args.map(arg => intervalEval(arg, variables))
        return fn.interval(intervals)
    }
    throw new Error(`Unsupported node: ${node.type}`)
}

function scalarEval(node, variables) {
    if (node.type === "number") return node.value
    if (node.type === "variable") return Number(variables[node.name])
    if (node.type === "negate") return -scalarEval(node.arg, variables)
    if (node.type === "binary") {
        const left = scalarEval(node.left, variables)
        const right = scalarEval(node.right, variables)
        if (node.op === "+") return left + right
        if (node.op === "-") return left - right
        if (node.op === "*") return left * right
        if (node.op === "/") return left / right
    }
    if (node.type === "call") {
        const args = node.args.map(arg => scalarEval(arg, variables))
        return FUNCTIONS[node.name].fn(...args)
    }
    throw new Error(`Unsupported node: ${node.type}`)
}

// 仓库中实际存在的公式（fioni / velina / jane / nangongyu 形态）
const cases = [
    { label: "fioni clamp(30+max(x-155,0)*0.7,0,100)", expression: "clamp(30 + max(x - 155, 0) * 0.7, 0, 100)", xRange: [116, 300], parameters: {} },
    { label: "velina clamp(floor(max(x-1.2,0)/0.01)*0.21,0,35)", expression: "clamp(floor(max(x - 1.2, 0) / 0.01) * 0.21, 0, 35)", xRange: [1.0, 1.8], parameters: {} },
    { label: "velina clamp(floor(max(x-1.2,0)/0.01)*0.5,0,84)", expression: "clamp(floor(max(x - 1.2, 0) / 0.01) * 0.5, 0, 84)", xRange: [1.0, 1.8], parameters: {} },
    { label: "jane clamp(40 + x*0.16,0,100)", expression: "clamp(40 + x * 0.16, 0, 100)", xRange: [200, 600], parameters: {} },
    { label: "参数化 clamp(base + max(x-th,0)*rate,0,cap)", expression: "clamp(base + max(x - th, 0) * rate, 0, cap)", xRange: [100, 400], parameters: { base: 30, th: 155, rate: 0.7, cap: 100 } },
]

let seed = 1234567
function random() {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
}

console.log("区间求值 enclosure 抽样验证（每个表达式 200000 个随机 x 落在随机区间内）")
for (const item of cases) {
    const ast = parseExpressionToAst(item.expression)
    let checked = 0
    let violations = 0
    let maxTightness = 0
    for (let i = 0; i < 200000; i += 1) {
        const span = item.xRange[1] - item.xRange[0]
        const a = item.xRange[0] + random() * span
        const b = item.xRange[0] + random() * span
        const xMin = Math.min(a, b)
        const xMax = Math.max(a, b)
        const interval = intervalEval(ast, { x: { min: xMin, max: xMax }, ...item.parameters })
        const samples = Array.from({ length: 9 }, (_, k) => xMin + (xMax - xMin) * k / 8)
        for (const x of samples) {
            const value = scalarEval(ast, { x, ...item.parameters })
            checked += 1
            if (value < interval.min - 1e-9 || value > interval.max + 1e-9) {
                violations += 1
                if (violations < 3) console.log("  VIOLATION", item.label, { x, value, interval })
            }
            maxTightness = Math.max(maxTightness, interval.max - interval.min)
        }
    }
    console.log(JSON.stringify({ label: item.label, checked, violations, maxIntervalWidth: Number(maxTightness.toFixed(6)) }))
}

// 展示 fioni 的区间上界（用于 objective kernel 的 anomalyCritRate 上界）
const fioniAst = parseExpressionToAst("clamp(30 + max(x - 155, 0) * 0.7, 0, 100)")
for (const [xMin, xMax] of [[116, 152], [152, 200], [200, 255], [255, 320]]) {
    console.log("fioni crit interval for initial mastery", [xMin, xMax], "=>", intervalEval(fioniAst, { x: { min: xMin, max: xMax } }))
}
