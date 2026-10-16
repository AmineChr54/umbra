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

  set('Price', 'Text', fmt(price, 2))
  set('Pct', 'Text', sign .. fmt(pct, 2) .. '%')
  set('Pct', 'FontColor', r .. ',' .. g .. ',' .. b .. ',255')
  set('Chg', 'Text', sign .. fmt(chg, 2) .. ' today')
  set('Chg', 'FontColor', r .. ',' .. g .. ',' .. b .. ',255')
  set('PillBg', 'Shape', 'Rectangle 206,40,76,26,13 | Fill Color ' .. r .. ',' .. g .. ',' .. b .. ',45 | StrokeWidth 0')

  -- sparkline: collect valid samples (Yahoo returns null for gaps)
  local vals = {}
  for tok in arr:gmatch('[^,]+') do
    local v = tonumber(tok)
    if v then vals[#vals + 1] = v end
  end
  local n = #vals
  if n >= 2 then
    local x0, w, yTop, h = 20, 260, 98, 40
    local lo, hi = prev, prev                       -- scale includes prev close
    for _, v in ipairs(vals) do
      if v < lo then lo = v end
      if v > hi then hi = v end
    end
    local span = (hi - lo) == 0 and 1 or (hi - lo)
    local function Y(v) return yTop + h - (v - lo) / span * h end

    local pts = {}
    for i, v in ipairs(vals) do
      pts[i] = string.format('%.1f,%.1f', x0 + (i - 1) / (n - 1) * w, Y(v))
    end
    local line = pts[1] .. ' | LineTo ' .. table.concat(pts, ' | LineTo ', 2)
    local base = yTop + h
    local area = string.format('%d,%d | LineTo ', x0, base) .. table.concat(pts, ' | LineTo ')
                 .. string.format(' | LineTo %d,%d | ClosePath 1', x0 + w, base)
    local refY = string.format('%.1f', Y(prev))

    set('Spark', 'LinePath', line)
    set('Spark', 'AreaPath', area)
    set('Spark', 'RefPath', x0 .. ',' .. refY .. ' | LineTo ' .. (x0 + w) .. ',' .. refY)
    set('Spark', 'AreaGrad', '90 | ' .. r .. ',' .. g .. ',' .. b .. ',90 ; 0.0 | ' .. r .. ',' .. g .. ',' .. b .. ',0 ; 1.0')
    set('Spark', 'Shape3', 'Path LinePath | Fill Color 0,0,0,0 | StrokeWidth 2 | Stroke Color ' .. r .. ',' .. g .. ',' .. b .. ',255 | StrokeLineJoin Round')
  end

  set('Updated', 'Text', 'updated ' .. os.date('%H:%M:%S') .. '  |  ' .. n .. ' samples (5 min)')
  SKIN:Bang('!UpdateMeterGroup', '')  -- no-op safety
  SKIN:Bang('!UpdateMeter', '*')
  SKIN:Bang('!Redraw')
  return price
end
