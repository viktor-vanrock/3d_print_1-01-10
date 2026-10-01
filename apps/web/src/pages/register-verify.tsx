import { useEffect, useState } from "react";
import { registerAccount, verifyRegistration, type AuthFormError } from "@domains/access";
import { navigate } from "../router.ts";
import { Button, Input } from "@shared/ui";
import "./login.css";
import styles from "./register-verify.module.css";
import { ErrorMessage } from "@shared/ui/error-message/error-message.tsx";

export function RegisterVerifyPage() {
  const [code, setCode] = useState(""); const [error, setError] = useState<AuthFormError | null>(null); const [cooldown,setCooldown]=useState(60); const email = sessionStorage.getItem("portal.registration.email") ?? "";
  useEffect(()=>{if(cooldown<=0)return;const timer=window.setTimeout(()=>setCooldown((value)=>value-1),1000);return()=>window.clearTimeout(timer);},[cooldown]);
  async function resend(){const result=await registerAccount({email,password:"resend-code-123",displayName:sessionStorage.getItem("portal.registration.displayName")??""});if(!result.ok){setError(result.error??{message:"Не удалось отправить код повторно."});return;}setCooldown(60);}
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await verifyRegistration(email, code);
    if (!result.ok) {
      if (result.error?.code === "auth.invalid_code.v1") return setError({ message: "Неверный код." });
      if (result.error?.code === "auth.code_expired.v1") return setError({ message: "Код истёк. Запросите новый код." });
      if (result.error?.code === "auth.account_blocked.v1" || result.error?.code === "auth.too_many_attempts.v1") return setError({ message: "Слишком много попыток. Повторите позже.", retryable: true });
      return setError(result.error ?? { message: "Неверный или просроченный код." });
    }
    sessionStorage.removeItem("portal.registration.email");
    sessionStorage.removeItem("portal.registration.displayName");
    navigate("/", "back");
    window.location.reload();
  }
  return <main className={`loginPage ${styles.page}`}><section className={`loginCard ${styles.card}`}><form className={`emailLoginForm ${styles.form}`} onSubmit={submit}><h1>Подтвердите email</h1><p>Введите 4-значный код из письма.</p><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} />{error && <ErrorMessage {...error} />}<Button type="submit" disabled={code.length !== 4}>Подтвердить</Button><Button type="button" disabled={cooldown>0} onClick={()=>void resend()}>{cooldown>0?`Отправить код повторно (${cooldown})`:"Отправить код повторно"}</Button></form></section></main>;
}
