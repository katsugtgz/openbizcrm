import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listProducts, recentSales } from "@/lib/pos/service";
import { formatIDR } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProductGrid } from "./product-grid";
import { AddProductDialog } from "./add-product-dialog";
import { RestockButton } from "./restock-button";

export const metadata = { title: "POS" };

async function PosData({ orgId, userId }: { orgId: string; userId: string }) {
  await requireOrgRole(userId, orgId, "member");
  const [products, sales] = await Promise.all([
    listProducts(orgId),
    recentSales(orgId, 10),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <ProductGrid
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          stockQty: p.stockQty,
        }))}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Produk</CardTitle>
              <CardDescription>
                {products.length} item terdaftar.
              </CardDescription>
            </div>
            <AddProductDialog />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Penjualan Terakhir</CardTitle>
            <CardDescription>10 transaksi terbaru.</CardDescription>
          </CardHeader>
          <CardContent>
            {sales.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Belum ada penjualan.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Struk</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map(({ sale, items }) => (
                    <TableRow key={sale.id}>
                      <TableCell>
                        <p className="font-mono text-xs">{sale.saleNumber}</p>
                        <Badge variant="outline">{sale.paymentMethod}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {items
                          .map((i) => `${i.productName} ×${i.qty}`)
                          .join(", ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatIDR(sale.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Restock</CardTitle>
            <CardDescription>Tambah stok produk.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada produk.</p>
            ) : (
              products.map((p) => (
                <RestockButton
                  key={p.id}
                  productId={p.id}
                  productName={p.name}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PosSkeleton() {
  return <Skeleton className="h-96 w-full" />;
}

export default async function PosPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">POS</h1>
        <p className="text-sm text-muted-foreground">
          Kasir: pilih produk, checkout, stok dan jurnal otomatis.
        </p>
      </div>
      <Suspense fallback={<PosSkeleton />}>
        <PosData orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}
