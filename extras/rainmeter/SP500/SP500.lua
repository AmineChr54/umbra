-- S&P 500 widget logic: parse Yahoo JSON, compute change, pick colors, build sparkline.

local lastBody = ""

-- 1234567.891 -> "1,234,567.89"
local function fmt(n, dec)
  local s = string.format('%.' .. dec .. 'f', math.abs(n))
  local int, frac = s:match('^(%d+)(.*)$')
  int = int:reverse():gsub('(%d%d%d)', '%1,'):reverse():gsub('^,', '')
  return int .. frac
end

local function set(meter, opt, val)
  SKIN:Bang('!SetOption', meter, opt, val)
end

function Initialize() end

function Update()
  local body = SKIN:GetMeasure('mBody'):GetStringValue()
  if body == '' or body == lastBody then return 0 end

  local price = tonumber(body:match('"regularMarketPrice":([%d%.]+)'))
  local prev  = tonumber(body:match('"chartPreviousClose":([%d%.]+)'))
  local arr   = body:match('"close":%[([^%]]*)%]')
  if not (price and prev and arr) then
    set('Updated', 'Text', 'data error, retrying...')
    SKIN:Bang('!UpdateMeter', 'Updated'); SKIN:Bang('!Redraw')
    return 0
  end
  lastBody = body

  -- change math
  local chg = price - prev
  local pct = prev ~= 0 and chg / prev * 100 or 0
  local up = chg > 0
  local flat = chg == 0
  local r, g, b = 60, 200, 120            -- up
  if not up then r, g, b = 235, 80, 80 end -- down
  if flat then r, g, b = 170, 170, 170 end
  local sign = up and '+' or (flat and '' or '-')
  local col = r .. ',' .. g .. ',' .. b

  set('Price', 'Text', fmt(price, 2))
  set('Pct', 'Text', sign .. fmt(pct, 2) .. '%')
  set('Pct', 'FontColor', col .. ',255')
  set('Chg', 'Text', sign .. fmt(chg, 2) .. ' today')
  set('Chg', 'FontColor', col .. ',255')
  set('PillBg', 'Shape', 'Rectangle 214,44,84,30,15 | Fill Color ' .. col .. ',45 | StrokeWidth 0')

  -- sparkline: collect valid samples (Yahoo returns null for gaps)
  local vals = {}
  for tok in arr:gmatch('[^,]+') do
    local v = tonumber(tok)
    if v then vals[#vals + 1] = v end
  end
  -- denoise 5-minute ticks with a 3-point moving average (first and last stay exact)
  do
    local sm = {}
    for i = 1, #vals do
      if i == 1 or i == #vals then sm[i] = vals[i]
      else sm[i] = (vals[i - 1] + vals[i] + vals[i + 1]) / 3 end
    end
    vals = sm
  end
  local n = #vals
  if n >= 2 then
    local x0, w, yTop, h = 22, 276, 112, 44
    local lo, hi = prev, prev                       -- scale includes prev close
    for _, v in ipairs(vals) do
      if v < lo then lo = v end
      if v > hi then hi = v end
    end
    local span = (hi - lo) == 0 and 1 or (hi - lo)

    local P = {}
    for i, v in ipairs(vals) do
      P[i] = { x0 + (i - 1) / (n - 1) * w, yTop + h - (v - lo) / span * h }
    end
    local function pt(i) return P[math.max(1, math.min(n, i))] end

    -- Catmull-Rom spline converted to cubic Beziers: a smooth curve through every sample
    local segs = {}
    for i = 1, n - 1 do
      local a, b2, c, d = pt(i - 1), pt(i), pt(i + 1), pt(i + 2)
      segs[i] = string.format('CurveTo %.1f,%.1f,%.1f,%.1f,%.1f,%.1f', c[1], c[2],
        b2[1] + (c[1] - a[1]) / 6, b2[2] + (c[2] - a[2]) / 6,
        c[1] - (d[1] - b2[1]) / 6, c[2] - (d[2] - b2[2]) / 6)
    end
    local curve = table.concat(segs, ' | ')
    local line = string.format('%.1f,%.1f | ', P[1][1], P[1][2]) .. curve
    local base = yTop + h + 2
    local area = string.format('%d,%d | LineTo %.1f,%.1f | ', x0, base, P[1][1], P[1][2]) .. curve
                 .. string.format(' | LineTo %.1f,%d | ClosePath 1', P[n][1], base)
    local refY = string.format('%.1f', yTop + h - (prev - lo) / span * h)

    set('Spark', 'LinePath', line)
    set('Spark', 'AreaPath', area)
    set('Spark', 'RefPath', x0 .. ',' .. refY .. ' | LineTo ' .. (x0 + w) .. ',' .. refY)
    set('Spark', 'AreaGrad', '90 | ' .. col .. ',100 ; 0.0 | ' .. col .. ',0 ; 1.0')
    set('Spark', 'Shape3', 'Path LinePath | Fill Color 0,0,0,0 | StrokeWidth 2.5 | Stroke Color ' .. col .. ',255 | StrokeLineJoin Round | StrokeStartCap Round | StrokeEndCap Round')
    -- live dot with a soft halo on the latest sample
    local last = P[n]
    set('Spark', 'Shape4', string.format('Ellipse %.1f,%.1f,9 | Fill Color %s,60 | StrokeWidth 0', last[1], last[2], col))
    set('Spark', 'Shape5', string.format('Ellipse %.1f,%.1f,4 | Fill Color %s,255 | StrokeWidth 1.5 | Stroke Color 13,14,20,255', last[1], last[2], col))
  end

  set('Updated', 'Text', 'updated ' .. os.date('%H:%M:%S') .. '  |  ' .. n .. ' samples (5 min)')
  SKIN:Bang('!UpdateMeter', '*')
  SKIN:Bang('!Redraw')
  return price
end
