import { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { passwordLogin, probeServer, qrLogin, setupAdmin } from "@/api/auth";
import { InvalidPairingUrlError, redeemConnectionPayload } from "@/api/pairing";
import { ApiError } from "@/api/types";
import { normalizeServerBaseUrl } from "@/api/utils";
import { Button, Card, Screen, TextField, toast } from "@/components/ui";
import { FontSize, Radius, Spacing } from "@/constants/theme";
import { useConnection } from "@/hooks/use-connection";
import { useTheme } from "@/hooks/use-theme";

const DEFAULT_PORT = "25808";

/** Map a login failure onto a user-actionable message. */
function loginErrorText(
  err: unknown,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t("rateLimited");
    if (err.status === 401) return t("loginFailed", { message: err.message });
    return t("loginFailed", { message: err.message });
  }
  return t("probeFailed");
}

export default function ConnectScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation("connect");
  const connection = useConnection();
  const isWeb = Platform.OS === "web";

  const lastBaseUrl =
    connection.phase === "disconnected" ? connection.lastBaseUrl : undefined;
  const initial = useMemo(() => {
    return { address: lastBaseUrl ?? "" };
  }, [lastBaseUrl]);

  const [address, setAddress] = useState(initial.address);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pasted, setPasted] = useState("");

  const baseUrl = isWeb ? "" : normalizeServerBaseUrl(address, DEFAULT_PORT);

  const submit = async () => {
    setError("");
    if (!isWeb && !baseUrl) {
      setError(t("addressPlaceholder"));
      return;
    }
    setBusy(true);
    try {
      const probe = await probeServer(baseUrl ?? "");
      if (!probe.reachable) {
        setError(t("probeFailed"));
        return;
      }
      if (probe.isNomifun === false) {
        setError(t("notNomifun"));
        return;
      }
      if (probe.needsSetup) {
        setNeedsSetup(true);
        if (!password) return; // show setup hint, wait for credentials
        await setupAdmin(baseUrl ?? "", username.trim(), password);
      } else {
        await passwordLogin(baseUrl ?? "", username.trim(), password);
      }
      toast.success(t("connectedAs", { username: username.trim() }));
    } catch (err) {
      setError(loginErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const submitPastedLink = async () => {
    setError("");
    setBusy(true);
    try {
      const user = await redeemConnectionPayload(
        pasted,
        isWeb ? (_pairBaseUrl, qrToken) => qrLogin("", qrToken) : undefined,
      );
      toast.success(t("connectedAs", { username: user.username }));
    } catch (err) {
      if (err instanceof InvalidPairingUrlError) {
        setError(t("qrInvalid"));
      } else if (
        err instanceof ApiError &&
        (err.status === 401 || err.status === 400)
      ) {
        setError(t("qrExpired"));
      } else {
        setError(loginErrorText(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen keyboardAvoiding>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Ionicons name="hardware-chip-outline" size={34} color="#FFF" />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>{t("title")}</Text>
        <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
          {t("subtitle")}
        </Text>
      </View>

      {!isWeb && (
        <>
          <Button
            onPress={() => router.push("/scan")}
            style={{ marginBottom: Spacing.sm }}
          >
            {t("scanQr")}
          </Button>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t("scanHint")}
          </Text>
        </>
      )}

      <Card style={{ marginTop: Spacing.xl }}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {needsSetup ? t("setupTitle") : t("manual")}
        </Text>
        <Text
          style={[
            styles.hint,
            { color: colors.textTertiary, marginBottom: Spacing.lg },
          ]}
        >
          {needsSetup
            ? t("setupHint")
            : isWeb
              ? t("webSameOrigin")
              : t("manualHint")}
        </Text>

        {!isWeb && (
          <TextField
            label={t("address")}
            placeholder={t("addressPlaceholder")}
            value={address}
            onChangeText={setAddress}
            keyboardType="url"
            autoComplete="off"
            autoCapitalize="none"
          />
        )}

        <TextField
          label={t("username")}
          value={username}
          onChangeText={setUsername}
        />
        <TextField
          label={t("password")}
          hint={needsSetup ? undefined : t("passwordHint")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          onSubmitEditing={submit}
        />

        {error ? (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        ) : null}

        <Button onPress={submit} loading={busy} disabled={!password}>
          {busy ? t("connecting") : t("connect")}
        </Button>
      </Card>

      <Card style={{ marginTop: Spacing.lg }}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {t("pasteLink")}
        </Text>
        <TextField
          placeholder="nomi://pair?v=1&url=…"
          hint={t("pasteLinkHint")}
          value={pasted}
          onChangeText={setPasted}
          autoComplete="off"
          autoCapitalize="none"
          keyboardType="url"
        />
        <Button
          variant="secondary"
          onPress={submitPastedLink}
          disabled={!pasted || busy}
        >
          {t("connect")}
        </Button>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingVertical: Spacing.xxl, gap: Spacing.sm },
  logo: {
    width: 72,
    height: 72,
    borderRadius: Radius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.title, fontWeight: "700" },
  subtitle: {
    fontSize: FontSize.sm,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  hint: { fontSize: FontSize.xs, lineHeight: 18, textAlign: "center" },
  error: { fontSize: FontSize.sm, marginBottom: Spacing.md, lineHeight: 20 },
});
