"use client";

/**
 * The write form. Plain HTML that posts on its own (no script: photos go as
 * they are, within the 9 MB the host takes); with script, each photo is
 * shrunk to 1600 px JPEG first, which keeps a post of ten photos a few MB on
 * a phone's connection.
 */

import { useState, type FormEvent } from "react";

export interface WriteInfo {
  state: "open" | "done" | "expired" | "not_found";
  store_name: string;
  order_number?: string;
  first_name?: string | null;
  items?: { product_id: string; name: string; image: string | null; reviewed: boolean }[];
  photos?: boolean;
  limits?: { title: number; body: number; name: number; photos_per_review: number };
}

const MAX_SIDE = 1600;
const MAX_POST = 9 * 1024 * 1024;

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file; // the API reads the original and says if it is not an image
  }
}

export function ReviewForm({
  token,
  info,
  ar,
  error,
}: {
  token: string;
  info: WriteInfo;
  ar: boolean;
  error?: string;
}) {
  const t = (en: string, arText: string) => (ar ? arText : en);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(error ?? "");
  const action = `/api/apps/reviews/write?t=${token}`;
  const words = ar
    ? ["وحش خالص", "مش عاجبني", "عادي", "حلو", "حلو جداً"]
    : ["Bad", "Poor", "Okay", "Good", "Great"];
  const problems: Record<string, string> = {
    bad_form: t("Rate at least one product, then send.", "قيّم منتج واحد على الأقل وابعت."),
    too_large: t("The photos are too large. Send fewer.", "الصور كبيرة. ابعت عدد أقل."),
    failed: t("We couldn't send your review. Try again.", "مقدرناش نبعت رأيك. جرّب تاني."),
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem("");
    const data = new FormData();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (value instanceof File) {
        if (value.size) data.append(key, await shrink(value), "photo.jpg");
      } else {
        data.append(key, value);
      }
    }
    let size = 0;
    for (const [, value] of data) size += value instanceof Blob ? value.size : value.length;
    if (size > MAX_POST) {
      setProblem("too_large");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(action, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      if (res.ok || res.status === 409) {
        window.location.assign(`/reviews/write?t=${token}&done=1`);
        return;
      }
      setProblem(res.status === 422 ? "bad_form" : res.status === 413 ? "too_large" : "failed");
    } catch {
      setProblem("failed");
    }
    setBusy(false);
  }

  const items = (info.items ?? []).filter((i) => !i.reviewed);
  const limits = info.limits;
  const field =
    "w-full rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-bg)] px-3 py-2";

  return (
    <form
      method="post"
      action={action}
      encType="multipart/form-data"
      onSubmit={submit}
      className="space-y-6"
    >
      <input type="hidden" name="t" value={token} />
      <div className="space-y-1">
        <h1 className="text-xl [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)]">
          {t("How was your order?", "طلبك عجبك؟")}
        </h1>
        <p className="text-sm text-[var(--ck-muted)]">
          {t("Order", "طلب رقم")} <bdi dir="ltr">{info.order_number}</bdi> ·{" "}
          <bdi>{info.store_name}</bdi>
        </p>
      </div>

      {items.map((item) => (
        <fieldset
          key={item.product_id}
          className="space-y-3 rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4"
        >
          <legend className="sr-only">{item.name}</legend>
          <div className="flex items-center gap-3">
            {item.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image} alt="" className="size-14 rounded object-cover" />
            )}
            <span className="font-semibold">{item.name}</span>
          </div>
          <div role="radiogroup" aria-label={t("Your rating", "تقييمك")} className="flex flex-wrap gap-2">
            {words.map((word, i) => (
              <label
                key={word}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-[var(--ck-radius)] border border-[var(--ck-border)] px-3 has-[:checked]:border-[var(--ck-fg)] has-[:checked]:font-semibold"
              >
                <input type="radio" name={`rating.${item.product_id}`} value={i + 1} className="sr-only" />
                <span aria-hidden="true">{"★".repeat(i + 1)}</span>
                <span>{word}</span>
              </label>
            ))}
          </div>
          <input
            name={`title.${item.product_id}`}
            maxLength={limits?.title}
            placeholder={t("Title (optional)", "عنوان (مش لازم)")}
            className={field}
          />
          <textarea
            name={`body.${item.product_id}`}
            maxLength={limits?.body}
            rows={3}
            placeholder={t("What did you like, or not?", "إيه اللي عجبك أو ماعجبكش؟")}
            className={field}
          />
          {info.photos && (
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--ck-muted)]">
                {t(
                  `Photos (up to ${limits?.photos_per_review ?? 5})`,
                  `صور (لحد ${limits?.photos_per_review ?? 5})`,
                )}
              </span>
              <input type="file" name={`photos.${item.product_id}`} accept="image/*" multiple />
            </label>
          )}
        </fieldset>
      ))}

      <label className="block space-y-1">
        <span className="text-sm text-[var(--ck-muted)]">
          {t("Your name as shown on the review", "اسمك اللي هيظهر على التقييم")}
        </span>
        <input
          name="name"
          defaultValue={info.first_name ?? ""}
          maxLength={limits?.name}
          className={field}
        />
      </label>

      {problem && (
        <p role="alert" className="text-sm text-[var(--ck-error,#b91c1c)]">
          {problems[problem] ?? problems.failed}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-11 w-full rounded-[var(--ck-radius)] bg-[var(--ck-button)] px-4 py-3 font-semibold text-[var(--ck-button-text)] disabled:opacity-60"
      >
        {busy ? t("Sending…", "بنبعت…") : t("Send my review", "ابعت رأيك")}
      </button>
    </form>
  );
}
