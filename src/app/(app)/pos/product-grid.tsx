"use client";

import { useMemo, useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { floorTax } from "@/lib/invoicing/totals";
import { formatIDR } from "@/lib/money";
import { jakartaDateISO } from "@/lib/attendance/rules";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkoutAction } from "./actions";

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stockQty: number;
}

export function ProductGrid({ products }: { products: Product[] }) {
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [taxPct, setTaxPct] = useState("0");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const cartItems = useMemo(
    () =>
      [...cart.entries()]
        .map(([id, qty]) => ({
          product: products.find((p) => p.id === id)!,
          qty,
        }))
        .filter((x) => x.product),
    [cart, products],
  );
  const subtotal = cartItems.reduce((s, x) => s + x.product.price * x.qty, 0);
  // Total bisa melewati MAX_SAFE_INTEGER sebelum checkout tervalidasi —
  // formatIDR lempar MoneyError saat render. Tandai tak aman, jangan crash
  // (cubic pr8 product-grid:54).
  const unsafe = (v: number) => !Number.isSafeInteger(v);
  const taxAmount = useMemo(() => {
    try {
      return floorTax(subtotal, Number(taxPct || "0"));
    } catch {
      return 0;
    }
  }, [subtotal, taxPct]);
  const total = subtotal + taxAmount;
  const totalsUsable =
    !unsafe(subtotal) && !unsafe(taxAmount) && !unsafe(total);

  function addToCart(p: Product) {
    setCart((prev) => {
      const next = new Map(prev);
      const cur = next.get(p.id) ?? 0;
      if (cur + 1 > p.stockQty) {
        toast.error(`Stok ${p.name} hanya ${p.stockQty}.`);
        return prev;
      }
      next.set(p.id, cur + 1);
      return next;
    });
  }

  function dec(id: string) {
    setCart((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? 0;
      if (cur <= 1) next.delete(id);
      else next.set(id, cur - 1);
      return next;
    });
  }

  function confirmCheckout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set(
      "items",
      JSON.stringify(
        cartItems.map((x) => ({ productId: x.product.id, qty: x.qty })),
      ),
    );
    startTransition(async () => {
      const result = await checkoutAction(formData);
      if (result.ok) {
        setCheckoutOpen(false);
        setCart(new Map());
        toast.success(result.message ?? "Checkout berhasil.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  const today = jakartaDateISO(new Date());

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {products.length === 0 ? (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
            Belum ada produk. Tambahkan lewat panel Produk.
          </p>
        ) : (
          products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addToCart(p)}
              disabled={p.stockQty === 0}
              className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
              aria-label={`Tambah ${p.name} ke keranjang, stok ${p.stockQty}`}
            >
              <span className="text-sm font-medium">{p.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {p.sku}
              </span>
              <span className="text-sm tabular-nums">{formatIDR(p.price)}</span>
              <span
                className={
                  p.stockQty === 0
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                stok {p.stockQty}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="rounded-lg border p-4">
        <p className="mb-2 text-sm font-medium">Keranjang</p>
        {cartItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Klik produk untuk menambah.
          </p>
        ) : (
          <ul className="space-y-2">
            {cartItems.map(({ product, qty }) => (
              <li
                key={product.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7"
                    onClick={() => dec(product.id)}
                    aria-label={`Kurangi ${product.name}`}
                  >
                    −
                  </Button>
                  <span className="w-8 text-center tabular-nums">{qty}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7"
                    onClick={() => addToCart(product)}
                    aria-label={`Tambah ${product.name}`}
                  >
                    +
                  </Button>
                </span>
                <span className="w-24 text-right tabular-nums">
                  {unsafe(product.price * qty)
                    ? "—"
                    : formatIDR(product.price * qty)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {totalsUsable ? (
          <div className="mt-3 space-y-1 border-t pt-3 text-sm tabular-nums">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatIDR(subtotal)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">PPN</span>
              <span>{formatIDR(taxAmount)}</span>
            </p>
            <p className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatIDR(total)}</span>
            </p>
          </div>
        ) : (
          <p className="mt-3 border-t pt-3 text-sm text-destructive">
            Total keranjang melebihi batas aman. Kurangi jumlah item.
          </p>
        )}
        <Button
          className="mt-3 w-full"
          disabled={cartItems.length === 0 || !totalsUsable}
          onClick={() => setCheckoutOpen(true)}
        >
          Checkout
        </Button>
      </div>

      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent>
          <form onSubmit={confirmCheckout} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Konfirmasi Checkout</DialogTitle>
              <DialogDescription>
                {cartItems.length} produk, stok dipotong, jurnal posted
                otomatis.
              </DialogDescription>
            </DialogHeader>
            <p className="text-lg font-semibold tabular-nums">
              {totalsUsable ? formatIDR(total) : "—"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pos-pay">Metode bayar</Label>
                <select
                  id="pos-pay"
                  name="paymentMethod"
                  defaultValue="cash"
                  aria-label="Metode bayar"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="cash">Kas</option>
                  <option value="transfer">Transfer</option>
                  <option value="qris">QRIS</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pos-date">Tanggal</Label>
                <Input
                  id="pos-date"
                  name="date"
                  type="date"
                  required
                  defaultValue={today}
                  aria-label="Tanggal transaksi (WIB)"
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="pos-tax">PPN (%)</Label>
                <Input
                  id="pos-tax"
                  name="taxPct"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCheckoutOpen(false)}
              >
                Batal
              </Button>
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Memproses…"
                  : totalsUsable
                    ? `Bayar ${formatIDR(total)}`
                    : "Bayar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
