import { useState } from "react";
import { Modal, View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import type { User } from "@quan1/contracts";
import { authenticate, logout, ApiError } from "./api";

export function Account({ user, setUser, vi }: {user: User | null; setUser: (user: User | null) => void; vi: boolean}) {
  const [visible, setVisible] = useState(false);
  const [register, setRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function close() { if (!busy) { setVisible(false); setPassword(""); setConfirmation(""); setError(""); } }
  async function submit() {
    if (busy) return;
    if (register && password !== confirmation) { setError("match"); return; }
    setBusy(true); setError("");
    try {
      const next = user ? (await logout(), null) : await authenticate(register ? "register" : "login", {
        email: email.trim(), password, ...(register ? { name: name.trim() } : {}),
      });
      setUser(next); setPassword(""); setConfirmation(""); setVisible(false);
    } catch (e) {
      setError(e instanceof ApiError ? String(e.status) : "network");
    } finally { setBusy(false); }
  }
  const message = error === "match" ? (vi ? "Mật khẩu nhập lại chưa khớp." : "Passwords do not match.") :
    error === "401" ? (vi ? "Email hoặc mật khẩu chưa đúng, hoặc phiên đã hết hạn." : "Incorrect email/password, or the session has expired.") :
    error === "409" ? (vi ? "Email này đã được đăng ký." : "This email is already registered.") :
    error === "403" ? (vi ? "Ứng dụng dành cho tài khoản du khách." : "Please use a visitor account in this app.") :
    error === "429" ? (vi ? "Quá nhiều yêu cầu. Vui lòng thử lại sau." : "Too many attempts. Please try again later.") :
    error === "422" ? (vi ? "Kiểm tra họ tên, email và mật khẩu (8–200 ký tự)." : "Check name, email and password (8–200 characters).") :
    (vi ? "Chưa kết nối được. Vui lòng thử lại." : "Could not connect. Please try again.");
  return <>
    <Pressable style={s.link} accessibilityRole="button" onPress={() => setVisible(true)}><Text style={s.linkText}>{user ? user.name : vi ? "Đăng nhập / Đăng ký" : "Sign in / Register"}</Text></Pressable>
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <Text style={s.heading}>{user ? (vi ? "Tài khoản" : "Account") : register ? (vi ? "Đăng ký" : "Register") : (vi ? "Đăng nhập" : "Sign in")}</Text>
          {user ? <Text>{user.name} · {user.email}</Text> : <>
            {register && <><Text>{vi ? "Họ tên" : "Name"}</Text><TextInput style={s.input} value={name} onChangeText={setName} autoComplete="name" maxLength={100} accessibilityLabel={vi ? "Họ tên" : "Name"}/></>}
            <Text>Email</Text><TextInput style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" accessibilityLabel="Email" maxLength={200}/>
            <Text>{vi ? "Mật khẩu" : "Password"}</Text><TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={register ? "new-password" : "current-password"} accessibilityLabel={vi ? "Mật khẩu" : "Password"} maxLength={200}/>
            {register && <><Text>{vi ? "Nhập lại mật khẩu" : "Confirm password"}</Text><TextInput style={s.input} value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" accessibilityLabel={vi ? "Nhập lại mật khẩu" : "Confirm password"} maxLength={200}/></>}
          </>}
          {!!error && <Text accessibilityRole="alert" style={s.error}>{message}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} style={s.primary} onPress={submit}><Text style={s.white}>{busy ? "…" : user ? (vi ? "Đăng xuất" : "Sign out") : register ? (vi ? "Đăng ký" : "Register") : (vi ? "Đăng nhập" : "Sign in")}</Text></Pressable>
          {!user && <Pressable accessibilityRole="button" disabled={busy} style={s.link} onPress={() => {setRegister(!register); setError("");}}><Text style={s.linkText}>{register ? (vi ? "Đã có tài khoản? Đăng nhập" : "Have an account? Sign in") : (vi ? "Chưa có tài khoản? Đăng ký" : "New here? Register")}</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={busy} style={s.link} onPress={close}><Text>{vi ? "Đóng" : "Close"}</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  screen: {flex: 1, backgroundColor: "#f8faf3"}, form: {padding: 26, paddingTop: 70, gap: 12},
  heading: {fontSize: 28, color: "#294735", fontWeight: "700", marginBottom: 12},
  input: {borderWidth: 1, borderColor: "#a4b597", borderRadius: 12, padding: 14, fontSize: 17, backgroundColor: "white"},
  primary: {backgroundColor: "#31523d", padding: 15, borderRadius: 12, alignItems: "center", minHeight: 48},
  white: {color: "white", fontSize: 17}, link: {paddingVertical: 12, minHeight: 44},
  linkText: {color: "#31523d", fontSize: 16, fontWeight: "600"}, error: {color: "#9d2828", fontSize: 16},
});
