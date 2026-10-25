import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import MapView, { Marker } from "react-native-maps";
import * as Speech from "expo-speech";
import * as SecureStore from "expo-secure-store";
import { getCategoryLabel, type Language, type Poi, type PublicCategory, type User } from "@quan1/contracts";
import { distanceM, fixProblem } from "../../packages/contracts/src/geofencing.ts";
import { Account } from "./src/Account";
import { engagement, imageUrl, request, restoreUser } from "./src/api";
import { Narrator, type PlaybackState } from "./src/narrator";
import { useGps } from "./src/useGps";

function Button({children, onPress, active = false, disabled = false}: {
  children: string; onPress: () => void; active?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{selected: active, disabled}}
    disabled={disabled} onPress={onPress} style={({pressed}) => [s.button, active && s.buttonActive, (pressed || disabled) && s.dim]}>
    <Text style={[s.buttonText, active && s.white]}>{children}</Text>
  </Pressable>;
}
function Visitor() {
  const [uiLocale, setUiLocale] = useState("vi");
  const [locale, setLocale] = useState("vi");
  const vi = uiLocale === "vi";
  const [languages, setLanguages] = useState<Language[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [places, setPlaces] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const authRevision = useRef(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [narrator] = useState(() => new Narrator({
    stop: () => Speech.stop(), voices: () => Speech.getAvailableVoicesAsync(),
    speak: (text, options) => Speech.speak(text, options),
  }, setPlayback));
  const language = languages.find(l => l.code === locale);
  const selected = places.find(p => p.id === selectedId);
  const translation = selected?.translations[locale];
  const scroll = useRef<ScrollView>(null);
  const map = useRef<MapView>(null);
  const gps = useGps(loading || error ? [] : places, locale, () => narrator.busy, poi => {
    setSelectedId(poi.id); setDetail(false); setView("map");
    void engagement(poi.id, "view");
    play(poi);
  }, () => { void narrator.stop().catch(() => {}); });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([SecureStore.getItemAsync("quan1.ui"), SecureStore.getItemAsync("quan1.locale")])
      .then(([ui, content]) => {
        if (!cancelled) { if (ui === "en") setUiLocale(ui); if (content) setLocale(content); }
      }).catch(() => {});
    return () => { cancelled = true; void narrator.stop().catch(() => {}); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const revision = authRevision.current;
    void restoreUser().then(value => {
      if (!cancelled && revision === authRevision.current) {setUser(value); setSessionError(false);}
    }).catch(() => {
      if (!cancelled && revision === authRevision.current) setSessionError(true);
    });
    return () => {cancelled = true;};
  }, [retry]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    void narrator.stop().catch(() => {});
    void Promise.all([
      request<Language[]>("/languages"), request<PublicCategory[]>("/categories"),
    ]).then(async ([available, groups]) => {
      if (cancelled) return;
      setLanguages(available); setCategories(groups);
      const valid = available.find(l => l.code === locale) ?? available[0];
      if (!valid) { setPlaces([]); setLoading(false); return; }
      if (valid.code !== locale) { setLocale(valid.code); return; }
      const data = await request<{items: Poi[]}>(`/pois?locale=${encodeURIComponent(locale)}`);
      if (!cancelled) {
        // Preserve the API's view_count DESC, id ASC ordering; public counts stay private.
        setPlaces(data.items);
        setCategory(current => groups.some(g => g.id === current) ? current : "");
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) {setError(true); setLoading(false);} });
    return () => { cancelled = true; };
  }, [locale, retry]);
  function changeUi() {
    const next = vi ? "en" : "vi";
    setUiLocale(next); void SecureStore.setItemAsync("quan1.ui", next).catch(() => {});
  }
  function changeNarration(next: string) {
    void narrator.stop().catch(() => {}); setLocale(next);
    void SecureStore.setItemAsync("quan1.locale", next).catch(() => {});
  }
  function open(poi: Poi, full: boolean) {
    void narrator.stop().catch(() => {});
    setSelectedId(poi.id); setDetail(full); void engagement(poi.id, "view");
    if (full) scroll.current?.scrollTo({y: 0, animated: true});
  }
  function play(poi: Poi) {
    const text = poi.translations[locale];
    if (!language || !text?.tts_ready || !text.text.trim()) return;
    void narrator.play(text.text, language.speech_locale, () => {
      gps.started(poi.id); void engagement(poi.id, "listen");
    });
  }
  function back() { void narrator.stop().catch(() => {}); setDetail(false); setSelectedId(null); }
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase();
  const filtered = places.filter(p => (!category || p.category_id === category) &&
    normalize(`${p.name} ${p.address} ${p.translations[locale]?.title ?? ""}`).includes(normalize(query.trim())));
  const gpsMessages: Record<string, [string, string]> = {
    idle: ["GPS đang tắt. Bật để xem vị trí và tự nghe gần địa điểm.", "GPS is off. Enable it for your location and nearby stories."],
    locating: ["Đang tìm vị trí…", "Finding your location…"],
    ready: ["GPS sẵn sàng · Tự nghe khi ở gần đủ lâu", "GPS ready · Stories start after a short stay nearby"],
    denied: ["Chưa được cấp quyền vị trí. Bạn có thể bật quyền trong cài đặt thiết bị.", "Location permission denied. You can enable it in device settings."],
    accuracy: ["Độ chính xác thấp. Hãy đến nơi thoáng hơn; chưa tự phát.", "Low accuracy. Move to an open area; automatic playback is waiting."],
    stale: ["Vị trí đã cũ. Đang chờ vị trí mới.", "Location is old. Waiting for a fresh fix."],
    unavailable: ["Chưa nhận được vị trí. Kiểm tra dịch vụ vị trí rồi tắt/bật GPS để thử lại.", "No location received. Check location services, then toggle GPS to retry."],
    background: ["Theo dõi đã dừng khi ứng dụng ở nền.", "Tracking stops while the app is in the background."],
  };
  const playbackMessages: Record<PlaybackState, [string, string]> = {
    idle: ["", ""], loading: ["Đang chuẩn bị giọng đọc…", "Preparing voice…"],
    speaking: ["Đang đọc thuyết minh", "Reading narration"],
    "missing-voice": ["Thiết bị chưa có giọng phù hợp. Cài giọng cho ngôn ngữ này trong cài đặt TTS; bạn vẫn có thể đọc bài.", "No matching voice is installed. Add this language in device TTS settings; the text remains available."],
    error: ["Chưa phát được giọng đọc. Kiểm tra âm lượng và thử lại.", "Speech could not start. Check your volume and retry."],
  };
  function distance(poi: Poi) {
    if (!gps.fix || fixProblem(gps.fix, Date.now()) !== "ready" || poi.latitude === null || poi.longitude === null) return "";
    const meters = distanceM(gps.fix, {latitude: poi.latitude, longitude: poi.longitude});
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  }
  function cover(poi: Poi) {
    const uri = poi.image_id ? imageUrl(poi.image_id) : poi.source?.image_url;
    return uri ? <Image accessibilityLabel={poi.translations[locale]?.title || poi.name} source={{uri}} style={s.cover} resizeMode="cover"/> :
      <View style={[s.cover, s.placeholder]}><Text style={s.placeholderText}>Saigon Stories</Text></View>;
  }
  function player(poi: Poi) {
    const text = poi.translations[locale];
    return <View style={s.player}>
      <Text style={s.eyebrow}>{vi ? "NGHE CÂU CHUYỆN" : "LISTEN TO THE STORY"}</Text>
      <View style={s.row}>
        <Button active onPress={() => play(poi)} disabled={!text?.tts_ready || !language || loading}>{vi ? "▶ Nghe từ đầu" : "▶ Play from start"}</Button>
        <Button onPress={() => {void narrator.stop().catch(() => {});}} disabled={!narrator.busy}>{vi ? "■ Dừng" : "■ Stop"}</Button>
      </View>
      {!!playbackMessages[playback][vi ? 0 : 1] && <Text accessibilityLiveRegion="polite" style={s.body}>{playbackMessages[playback][vi ? 0 : 1]}</Text>}
      {!text?.tts_ready && <Text style={s.body}>{vi ? "Chưa có bài đọc cho ngôn ngữ này. Hãy chọn ngôn ngữ khác." : "No narration in this language yet. Choose another language."}</Text>}
    </View>;
  }
  return <SafeAreaView style={s.screen}>
    <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.header}><Text accessibilityRole="header" style={s.logo}>saigon<Text style={{fontWeight: "400"}}>stories.</Text></Text><Button onPress={changeUi}>{vi ? "English" : "Tiếng Việt"}</Button></View>
      <Account user={user} setUser={value => {
        authRevision.current++; setUser(value); setSessionError(false);
      }} vi={vi}/>
      {sessionError && <View style={s.notice}><Text style={s.body}>{vi ? "Chưa kiểm tra được phiên đăng nhập. Nội dung công khai vẫn xem được." : "Could not check your session. Public stories are still available."}</Text><Button onPress={() => setRetry(n => n + 1)}>{vi ? "Thử lại" : "Retry"}</Button></View>}
      <Text style={s.label}>{vi ? "Ngôn ngữ thuyết minh" : "Narration language"}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={s.languageRow}>
        {languages.map(l => <Button key={l.code} active={l.code === locale} onPress={() => changeNarration(l.code)}>{`${l.code.toUpperCase()} ${l.native_name}`}</Button>)}
      </ScrollView>
      {loading ? <View style={s.empty}><ActivityIndicator color="#31523d" size="large"/><Text style={s.body}>{vi ? "Đang tải những câu chuyện…" : "Loading stories…"}</Text></View> :
        error ? <View style={s.notice}><Text accessibilityRole="alert" style={s.body}>{vi ? "Chưa tải được nội dung. Kiểm tra kết nối mạng rồi thử lại." : "Could not load stories. Check your connection and retry."}</Text><Button onPress={() => setRetry(n => n + 1)}>{vi ? "Thử lại" : "Retry"}</Button></View> :
        detail && selected ? <>
          <Button onPress={back}>{vi ? "← Tất cả địa điểm" : "← All places"}</Button>
          {cover(selected)}
          <Text style={s.eyebrow}>{vi ? "QUẬN 1 · SÀI GÒN" : "DISTRICT 1 · SAIGON"}</Text>
          <Text accessibilityRole="header" style={[s.title, language?.direction === "rtl" && s.rtl]}>{translation?.title || selected.name}</Text>
          <Text style={s.body}>{selected.address}{distance(selected) ? ` · ${distance(selected)}` : ""}</Text>
          {player(selected)}
          <Text selectable style={[s.story, language?.direction === "rtl" && s.rtl]}>{translation?.text || (vi ? "Chưa có thuyết minh cho ngôn ngữ này." : "Narration is not available in this language.")}</Text>
          {selected.source && <View style={s.notice}><Text selectable style={s.small}>{vi ? "Nguồn" : "Source"}: {selected.source.title}{"\n"}{selected.source.url}{"\n"}{selected.source.license}</Text>
            {!!selected.source.image_url && <Text selectable style={s.small}>{vi ? "Ảnh" : "Image"}: {selected.source.image_author} · {selected.source.image_license}{"\n"}{selected.source.image_page_url}</Text>}
          </View>}
        </> : <>
          <View style={s.hero}><Text style={s.eyebrow}>{vi ? "LẮNG NGHE SÀI GÒN" : "LISTEN TO SAIGON"}</Text><Text accessibilityRole="header" style={s.title}>{vi ? "Sài Gòn, qua từng câu chuyện." : "Saigon, told one story at a time."}</Text><Text style={s.body}>{vi ? "Khám phá Quận 1. Chọn một địa điểm và nghe câu chuyện theo nhịp bước của bạn." : "Explore District 1. Choose a place and hear its story at your own pace."}</Text></View>
          <TextInput style={s.input} placeholder={vi ? "Tìm địa điểm, địa chỉ…" : "Search places, addresses…"} placeholderTextColor="#65775f" value={query} onChangeText={setQuery} accessibilityLabel={vi ? "Tìm địa điểm" : "Search places"}/>
          <View style={s.row}><Button active={!category} onPress={() => setCategory("")}>{vi ? "Tất cả" : "All"}</Button>{categories.map(c => <Button key={c.id} active={category === c.id} onPress={() => setCategory(c.id)}>{getCategoryLabel(c, uiLocale)}</Button>)}</View>
          <View style={s.row}><Button active={view === "list"} onPress={() => setView("list")}>{vi ? "Danh sách" : "List"}</Button><Button active={view === "map"} onPress={() => setView("map")}>{vi ? "Bản đồ" : "Map"}</Button></View>
          <View style={s.notice}>
            <Button active={gps.enabled} onPress={() => {void gps.toggle();}}>{gps.enabled ? (vi ? "Tắt GPS & tự nghe" : "Disable GPS & auto play") : (vi ? "Bật GPS & tự nghe" : "Enable GPS & auto play")}</Button>
            <Text accessibilityLiveRegion="polite" style={s.small}>{(gpsMessages[gps.status] ?? gpsMessages.unavailable)[vi ? 0 : 1]}</Text>
            {gps.fix && <Text style={s.small}>{vi ? "Vị trí" : "Location"}: {gps.fix.latitude.toFixed(5)}, {gps.fix.longitude.toFixed(5)} · {Number.isFinite(gps.fix.accuracy) ? `±${Math.round(gps.fix.accuracy)} m` : vi ? "Chưa rõ độ chính xác" : "Accuracy unavailable"}</Text>}
          </View>
          {view === "map" && <>
            <MapView ref={map} accessibilityLabel={vi ? "Bản đồ địa điểm" : "Places map"} style={s.map} initialRegion={{latitude: 10.7769, longitude: 106.7009, latitudeDelta: 0.035, longitudeDelta: 0.035}}>
              {filtered.filter(p => p.latitude !== null && p.longitude !== null).map(p => <Marker key={p.id} coordinate={{latitude: p.latitude!, longitude: p.longitude!}} title={p.translations[locale]?.title || p.name} description={p.address} pinColor="#31523d" onPress={() => open(p, false)}/>)}
              {gps.fix && fixProblem(gps.fix, Date.now()) === "ready" && <Marker coordinate={gps.fix} title={vi ? "Vị trí của bạn" : "Your location"} pinColor="#297cca"/>}
            </MapView>
            <Button disabled={!gps.fix || fixProblem(gps.fix, Date.now()) !== "ready"} onPress={() => {
              if (gps.fix && fixProblem(gps.fix, Date.now()) === "ready") {
                map.current?.animateToRegion({...gps.fix, latitudeDelta: 0.012, longitudeDelta: 0.012}, 500);
              }
            }}>{vi ? "Vị trí của tôi" : "My location"}</Button>
            <Text style={s.small}>{vi ? "Chạm ghim để xem và nghe câu chuyện. Địa điểm chưa có tọa độ vẫn có trong danh sách." : "Tap a pin to view and listen. Places without coordinates remain in the list."}</Text>
            {selected && <View style={s.card}><Text style={s.cardTitle}>{selected.translations[locale]?.title || selected.name}</Text><Text style={s.body}>{selected.address} · {distance(selected)}</Text>{player(selected)}<Button onPress={() => open(selected, true)}>{vi ? "Xem toàn bộ bài" : "Read full story"}</Button><Button onPress={back}>{vi ? "Đóng" : "Close"}</Button></View>}
          </>}
          {!filtered.length && <Text style={s.empty}>{places.length ? (vi ? "Không tìm thấy địa điểm phù hợp." : "No matching places.") : (vi ? "Chưa có địa điểm được công bố." : "No published places yet.")}</Text>}
          {view === "list" && filtered.map(p => <Pressable key={p.id} style={s.card} accessibilityRole="button" accessibilityLabel={p.translations[locale]?.title || p.name} onPress={() => open(p, true)}>
            {cover(p)}<Text style={s.eyebrow}>{getCategoryLabel(categories.find(c => c.id === p.category_id), uiLocale)}</Text><Text style={s.cardTitle}>{p.translations[locale]?.title || p.name}</Text><Text style={s.body}>{p.address}</Text>{!!distance(p) && <Text style={s.small}>{distance(p)}</Text>}<Text style={s.label}>{vi ? "Khám phá câu chuyện →" : "Explore this story →"}</Text>
          </Pressable>)}
        </>}
      <Text style={s.footer}>SAIGON STORIES · {vi ? "Bước chậm lại, nghe nhiều hơn." : "Walk slowly. Hear more."}</Text>
    </ScrollView>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Visitor/></SafeAreaProvider>; }
const s = StyleSheet.create({
  screen: {flex: 1, backgroundColor: "#f8faf3"}, content: {padding: 20, gap: 16, paddingBottom: 40},
  header: {flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10},
  logo: {fontSize: 25, fontWeight: "700", color: "#31523d", letterSpacing: -1},
  row: {flexDirection: "row", flexWrap: "wrap", gap: 8}, languageRow: {gap: 8, paddingVertical: 4},
  button: {minHeight: 46, paddingVertical: 12, paddingHorizontal: 15, borderRadius: 24, borderWidth: 1, borderColor: "#a6b793", alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff", flexShrink: 1},
  buttonActive: {backgroundColor: "#31523d", borderColor: "#31523d"}, buttonText: {color: "#294735", fontSize: 16, fontWeight: "600"}, white: {color: "#ffffff"}, dim: {opacity: 0.55},
  label: {fontSize: 16, color: "#31523d", fontWeight: "600"}, body: {fontSize: 17, color: "#425b45", lineHeight: 27},
  small: {fontSize: 14, color: "#52664d", lineHeight: 23}, title: {fontSize: 36, lineHeight: 47, fontWeight: "700", color: "#294735", letterSpacing: -1},
  eyebrow: {fontSize: 12, letterSpacing: 1.5, color: "#526c45", fontWeight: "700", marginTop: 8},
  hero: {paddingVertical: 24, gap: 16}, input: {padding: 16, minHeight: 50, borderWidth: 1, borderColor: "#acba9e", borderRadius: 16, fontSize: 17, color: "#294735", backgroundColor: "#ffffff"},
  empty: {paddingVertical: 40, textAlign: "center", alignItems: "center", gap: 15, fontSize: 17, color: "#425b45"},
  notice: {backgroundColor: "#eaf0df", borderRadius: 16, padding: 16, gap: 10},
  card: {backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#dce5d3", borderRadius: 20, padding: 16, gap: 12},
  cover: {width: "100%", height: 195, borderRadius: 14, backgroundColor: "#dce5d3"},
  placeholder: {alignItems: "center", justifyContent: "center"}, placeholderText: {fontSize: 24, color: "#748866"},
  cardTitle: {fontSize: 23, color: "#294735", fontWeight: "700", lineHeight: 32}, map: {height: 350, width: "100%", borderRadius: 16},
  player: {backgroundColor: "#edf2e4", borderRadius: 16, padding: 16, gap: 12},
  story: {fontSize: 19, lineHeight: 33, color: "#294735"}, rtl: {writingDirection: "rtl", textAlign: "right"},
  footer: {fontSize: 12, color: "#65775f", textAlign: "center", marginTop: 24, lineHeight: 22},
});
