// Minimal JSON value, parser and serializer for the Reelform native helpers.
//
// Header-only, no platform dependencies, C++17. Scope is deliberately small:
// the helper protocol exchanges one flat-ish JSON object per stdio line
// (ENGINEERING_SPEC §5.5), so we need correctness and predictable output, not
// speed or a rich API.
//
// - Integers that fit in int64 are kept exact (host-clock nanoseconds exceed
//   2^53 after ~104 days of uptime; we never round them through double).
// - Objects preserve insertion order; setting an existing key replaces it
//   (duplicate keys on parse: last one wins).
// - Non-finite doubles serialize as null.
// - Strings are UTF-8 byte sequences; \uXXXX escapes (incl. surrogate pairs)
//   decode to UTF-8, lone surrogates decode to U+FFFD.
#pragma once

#include <clocale>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <vector>

namespace reelform::json {

enum class Type { Null, Bool, Int, Double, String, Array, Object };

class Value {
 public:
  Value() = default;
  Value(std::nullptr_t) {}
  Value(bool b) : type_(Type::Bool), bool_(b) {}
  template <typename T,
            std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool>, int> = 0>
  Value(T v) {
    if (std::is_unsigned_v<T> &&
        static_cast<std::uint64_t>(v) >
            static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
      type_ = Type::Double;
      double_ = static_cast<double>(v);
    } else {
      type_ = Type::Int;
      int_ = static_cast<std::int64_t>(v);
    }
  }
  template <typename T, std::enable_if_t<std::is_floating_point_v<T>, int> = 0>
  Value(T v) : type_(Type::Double), double_(static_cast<double>(v)) {}
  Value(const char* s) : type_(Type::String), string_(s != nullptr ? s : "") {}
  Value(std::string s) : type_(Type::String), string_(std::move(s)) {}
  Value(std::string_view s) : type_(Type::String), string_(s) {}

  static Value array() {
    Value v;
    v.type_ = Type::Array;
    return v;
  }
  static Value object() {
    Value v;
    v.type_ = Type::Object;
    return v;
  }

  Type type() const { return type_; }
  bool isNull() const { return type_ == Type::Null; }
  bool isBool() const { return type_ == Type::Bool; }
  bool isInt() const { return type_ == Type::Int; }
  bool isNumber() const { return type_ == Type::Int || type_ == Type::Double; }
  bool isString() const { return type_ == Type::String; }
  bool isArray() const { return type_ == Type::Array; }
  bool isObject() const { return type_ == Type::Object; }

  bool asBool(bool fallback = false) const { return type_ == Type::Bool ? bool_ : fallback; }
  std::int64_t asInt(std::int64_t fallback = 0) const {
    if (type_ == Type::Int) return int_;
    if (type_ == Type::Double && std::isfinite(double_) && std::trunc(double_) == double_ &&
        double_ >= -9.2233720368547758e18 && double_ < 9.2233720368547758e18) {
      return static_cast<std::int64_t>(double_);
    }
    return fallback;
  }
  double asDouble(double fallback = 0.0) const {
    if (type_ == Type::Double) return double_;
    if (type_ == Type::Int) return static_cast<double>(int_);
    return fallback;
  }
  const std::string& asString() const {
    static const std::string kEmpty;
    return type_ == Type::String ? string_ : kEmpty;
  }

  // ---- arrays ----
  std::size_t size() const {
    if (type_ == Type::Array) return items_.size();
    if (type_ == Type::Object) return values_.size();
    return 0;
  }
  Value& push(Value v) {
    if (type_ != Type::Array) *this = array();
    items_.push_back(std::move(v));
    return *this;
  }
  const Value& at(std::size_t i) const {
    static const Value kNull;
    return (type_ == Type::Array && i < items_.size()) ? items_[i] : kNull;
  }

  // ---- objects ----
  Value& set(std::string key, Value v) {
    if (type_ != Type::Object) *this = object();
    for (std::size_t i = 0; i < keys_.size(); ++i) {
      if (keys_[i] == key) {
        values_[i] = std::move(v);
        return *this;
      }
    }
    keys_.push_back(std::move(key));
    values_.push_back(std::move(v));
    return *this;
  }
  const Value* find(std::string_view key) const {
    if (type_ != Type::Object) return nullptr;
    for (std::size_t i = 0; i < keys_.size(); ++i) {
      if (keys_[i] == key) return &values_[i];
    }
    return nullptr;
  }
  const std::string& keyAt(std::size_t i) const { return keys_.at(i); }
  const Value& valueAt(std::size_t i) const { return values_.at(i); }

  std::string dump() const {
    std::string out;
    dumpTo(out);
    return out;
  }

  void dumpTo(std::string& out) const {
    switch (type_) {
      case Type::Null: out += "null"; break;
      case Type::Bool: out += bool_ ? "true" : "false"; break;
      case Type::Int: out += std::to_string(int_); break;
      case Type::Double: appendDouble(out, double_); break;
      case Type::String: appendEscaped(out, string_); break;
      case Type::Array:
        out.push_back('[');
        for (std::size_t i = 0; i < items_.size(); ++i) {
          if (i != 0) out.push_back(',');
          items_[i].dumpTo(out);
        }
        out.push_back(']');
        break;
      case Type::Object:
        out.push_back('{');
        for (std::size_t i = 0; i < keys_.size(); ++i) {
          if (i != 0) out.push_back(',');
          appendEscaped(out, keys_[i]);
          out.push_back(':');
          values_[i].dumpTo(out);
        }
        out.push_back('}');
        break;
    }
  }

  static void appendEscaped(std::string& out, std::string_view s) {
    static const char* kHex = "0123456789abcdef";
    out.push_back('"');
    for (char ch : s) {
      const auto c = static_cast<unsigned char>(ch);
      switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
          if (c < 0x20) {
            out += "\\u00";
            out.push_back(kHex[c >> 4]);
            out.push_back(kHex[c & 0xF]);
          } else {
            out.push_back(ch);
          }
      }
    }
    out.push_back('"');
  }

 private:
  static void appendDouble(std::string& out, double d) {
    if (!std::isfinite(d)) {
      out += "null";
      return;
    }
    char buf[40];
    // Shortest of %.15g / %.17g that round-trips. Normalize a locale decimal
    // comma back to '.', since JSON is locale-independent.
    std::snprintf(buf, sizeof buf, "%.15g", d);
    if (parseDoubleLocaleSafe(buf) != d) std::snprintf(buf, sizeof buf, "%.17g", d);
    for (char* p = buf; *p != '\0'; ++p) {
      if (*p == ',') *p = '.';
    }
    out += buf;
  }

 public:
  // strtod honours the C locale's decimal point; JSON always uses '.'.
  static double parseDoubleLocaleSafe(std::string s) {
    const lconv* lc = std::localeconv();
    const char dp = (lc != nullptr && lc->decimal_point != nullptr && lc->decimal_point[0] != '\0')
                        ? lc->decimal_point[0]
                        : '.';
    for (char& c : s) {
      if (c == '.' || c == ',') c = dp;
    }
    return std::strtod(s.c_str(), nullptr);
  }

 private:
  Type type_ = Type::Null;
  bool bool_ = false;
  std::int64_t int_ = 0;
  double double_ = 0.0;
  std::string string_;
  std::vector<Value> items_;
  std::vector<std::string> keys_;
  std::vector<Value> values_;
};

struct ParseResult {
  bool ok = false;
  Value value;
  std::string error;
  std::size_t offset = 0;
};

namespace detail {

class Parser {
 public:
  explicit Parser(std::string_view s) : s_(s) {}

  ParseResult run() {
    ParseResult r;
    skipWs();
    Value v;
    if (!parseValue(v, 0)) {
      r.error = error_;
      r.offset = pos_;
      return r;
    }
    skipWs();
    if (pos_ != s_.size()) {
      r.error = "trailing characters";
      r.offset = pos_;
      return r;
    }
    r.ok = true;
    r.value = std::move(v);
    return r;
  }

 private:
  static constexpr int kMaxDepth = 64;

  bool fail(const char* msg) {
    error_ = msg;
    return false;
  }

  void skipWs() {
    while (pos_ < s_.size()) {
      const char c = s_[pos_];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        ++pos_;
      } else {
        break;
      }
    }
  }

  bool consumeLiteral(std::string_view lit) {
    if (s_.substr(pos_, lit.size()) != lit) return false;
    pos_ += lit.size();
    return true;
  }

  bool parseValue(Value& out, int depth) {
    if (depth > kMaxDepth) return fail("nesting too deep");
    if (pos_ >= s_.size()) return fail("unexpected end of input");
    const char c = s_[pos_];
    switch (c) {
      case 'n':
        if (!consumeLiteral("null")) return fail("invalid literal");
        out = Value();
        return true;
      case 't':
        if (!consumeLiteral("true")) return fail("invalid literal");
        out = Value(true);
        return true;
      case 'f':
        if (!consumeLiteral("false")) return fail("invalid literal");
        out = Value(false);
        return true;
      case '"': {
        std::string str;
        if (!parseString(str)) return false;
        out = Value(std::move(str));
        return true;
      }
      case '[': return parseArray(out, depth);
      case '{': return parseObject(out, depth);
      default:
        if (c == '-' || (c >= '0' && c <= '9')) return parseNumber(out);
        return fail("unexpected character");
    }
  }

  bool parseArray(Value& out, int depth) {
    ++pos_;  // [
    out = Value::array();
    skipWs();
    if (pos_ < s_.size() && s_[pos_] == ']') {
      ++pos_;
      return true;
    }
    for (;;) {
      skipWs();
      Value item;
      if (!parseValue(item, depth + 1)) return false;
      out.push(std::move(item));
      skipWs();
      if (pos_ >= s_.size()) return fail("unterminated array");
      if (s_[pos_] == ',') {
        ++pos_;
        continue;
      }
      if (s_[pos_] == ']') {
        ++pos_;
        return true;
      }
      return fail("expected ',' or ']'");
    }
  }

  bool parseObject(Value& out, int depth) {
    ++pos_;  // {
    out = Value::object();
    skipWs();
    if (pos_ < s_.size() && s_[pos_] == '}') {
      ++pos_;
      return true;
    }
    for (;;) {
      skipWs();
      if (pos_ >= s_.size() || s_[pos_] != '"') return fail("expected object key");
      std::string key;
      if (!parseString(key)) return false;
      skipWs();
      if (pos_ >= s_.size() || s_[pos_] != ':') return fail("expected ':'");
      ++pos_;
      skipWs();
      Value v;
      if (!parseValue(v, depth + 1)) return false;
      out.set(std::move(key), std::move(v));
      skipWs();
      if (pos_ >= s_.size()) return fail("unterminated object");
      if (s_[pos_] == ',') {
        ++pos_;
        continue;
      }
      if (s_[pos_] == '}') {
        ++pos_;
        return true;
      }
      return fail("expected ',' or '}'");
    }
  }

  static void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp < 0x80) {
      out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
      out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
      out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
      out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
  }

  bool readHex4(std::uint32_t& cp) {
    if (pos_ + 4 > s_.size()) return fail("truncated \\u escape");
    cp = 0;
    for (int i = 0; i < 4; ++i) {
      const char h = s_[pos_++];
      cp <<= 4;
      if (h >= '0' && h <= '9') {
        cp |= static_cast<std::uint32_t>(h - '0');
      } else if (h >= 'a' && h <= 'f') {
        cp |= static_cast<std::uint32_t>(h - 'a' + 10);
      } else if (h >= 'A' && h <= 'F') {
        cp |= static_cast<std::uint32_t>(h - 'A' + 10);
      } else {
        return fail("invalid \\u escape");
      }
    }
    return true;
  }

  bool parseString(std::string& out) {
    ++pos_;  // opening quote
    for (;;) {
      if (pos_ >= s_.size()) return fail("unterminated string");
      const auto c = static_cast<unsigned char>(s_[pos_]);
      if (c == '"') {
        ++pos_;
        return true;
      }
      if (c < 0x20) return fail("control character in string");
      if (c != '\\') {
        out.push_back(static_cast<char>(c));
        ++pos_;
        continue;
      }
      ++pos_;
      if (pos_ >= s_.size()) return fail("unterminated escape");
      const char e = s_[pos_++];
      switch (e) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          std::uint32_t cp = 0;
          if (!readHex4(cp)) return false;
          if (cp >= 0xD800 && cp <= 0xDBFF) {
            // High surrogate: expect a low surrogate escape next.
            if (pos_ + 6 <= s_.size() && s_[pos_] == '\\' && s_[pos_ + 1] == 'u') {
              const std::size_t save = pos_;
              pos_ += 2;
              std::uint32_t lo = 0;
              if (!readHex4(lo)) return false;
              if (lo >= 0xDC00 && lo <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
              } else {
                pos_ = save;
                cp = 0xFFFD;
              }
            } else {
              cp = 0xFFFD;
            }
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            cp = 0xFFFD;
          }
          appendUtf8(out, cp);
          break;
        }
        default: return fail("invalid escape");
      }
    }
  }

  bool parseNumber(Value& out) {
    const std::size_t start = pos_;
    bool negative = false;
    if (s_[pos_] == '-') {
      negative = true;
      ++pos_;
    }
    if (pos_ >= s_.size()) return fail("invalid number");
    if (s_[pos_] == '0') {
      ++pos_;
      if (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') {
        return fail("leading zero in number");
      }
    } else if (s_[pos_] >= '1' && s_[pos_] <= '9') {
      while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_;
    } else {
      return fail("invalid number");
    }
    bool isFloat = false;
    if (pos_ < s_.size() && s_[pos_] == '.') {
      isFloat = true;
      ++pos_;
      if (pos_ >= s_.size() || s_[pos_] < '0' || s_[pos_] > '9') return fail("invalid fraction");
      while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_;
    }
    if (pos_ < s_.size() && (s_[pos_] == 'e' || s_[pos_] == 'E')) {
      isFloat = true;
      ++pos_;
      if (pos_ < s_.size() && (s_[pos_] == '+' || s_[pos_] == '-')) ++pos_;
      if (pos_ >= s_.size() || s_[pos_] < '0' || s_[pos_] > '9') return fail("invalid exponent");
      while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_;
    }
    const std::string_view text = s_.substr(start, pos_ - start);
    if (!isFloat) {
      // Exact int64 when it fits; otherwise fall through to double.
      const std::uint64_t limit =
          negative ? static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max()) + 1U
                   : static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max());
      std::uint64_t acc = 0;
      bool overflow = false;
      for (std::size_t i = negative ? 1 : 0; i < text.size(); ++i) {
        const auto d = static_cast<std::uint64_t>(text[i] - '0');
        if (acc > (limit - d) / 10U) {
          overflow = true;
          break;
        }
        acc = acc * 10U + d;
      }
      if (!overflow) {
        if (negative) {
          out = Value(acc == limit ? std::numeric_limits<std::int64_t>::min()
                                   : -static_cast<std::int64_t>(acc));
        } else {
          out = Value(static_cast<std::int64_t>(acc));
        }
        return true;
      }
    }
    out = Value(Value::parseDoubleLocaleSafe(std::string(text)));
    return true;
  }

  std::string_view s_;
  std::size_t pos_ = 0;
  std::string error_;
};

}  // namespace detail

inline ParseResult parse(std::string_view text) { return detail::Parser(text).run(); }

}  // namespace reelform::json
