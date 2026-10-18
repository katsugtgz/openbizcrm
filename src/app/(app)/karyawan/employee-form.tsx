"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { formatIDR, parseIDRInput } from "@/lib/money";
import type { Employee } from "@/lib/repos/hrm-repo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TAX_STATUSES = ["TK0", "TK1", "TK2", "TK3", "KI0", "KI1", "KI2", "KI3"];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Menyimpan…" : label}
    </Button>
  );
}

/** Form create/edit karyawan. Gaji pakai parseIDRInput (digit saja). */
export function EmployeeForm({
  employee,
  action,
}: {
  employee?: Employee;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [salary, setSalary] = useState(
    employee ? String(employee.baseSalary) : "",
  );
  const salaryDisplay = salary ? formatIDR(Number(salary)) : "";

  function onSalaryChange(value: string) {
    try {
      setSalary(String(parseIDRInput(value.replace(/\D/g, "") || "0")));
    } catch {
      setSalary("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {employee ? "Edit Karyawan" : "Karyawan Baru"}
        </CardTitle>
        <CardDescription>
          Gaji dalam rupiah bulat; saldo &amp; payroll memakai integer IDR.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          {employee && <input type="hidden" name="id" value={employee.id} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="employeeNo">No. Karyawan</Label>
              <Input
                id="employeeNo"
                name="employeeNo"
                required
                defaultValue={employee?.employeeNo}
                placeholder="EMP-001"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Nama</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={employee?.name}
                placeholder="Nama lengkap"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                defaultValue={employee?.status ?? "active"}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                <option value="active">Aktif</option>
                <option value="resigned">Resign</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="taxStatus">Status Pajak (TER)</Label>
              <select
                id="taxStatus"
                name="taxStatus"
                defaultValue={employee?.taxStatus ?? "TK0"}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                {TAX_STATUSES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="baseSalary">Gaji Pokok (Rp/bulan)</Label>
              <Input
                id="baseSalary"
                name="baseSalary"
                required
                inputMode="numeric"
                value={salary}
                onChange={(e) => onSalaryChange(e.target.value)}
              />
              {salaryDisplay && (
                <p className="text-xs text-muted-foreground">{salaryDisplay}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hireDate">Tanggal Masuk</Label>
              <Input
                id="hireDate"
                name="hireDate"
                type="date"
                defaultValue={employee?.hireDate ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bankName">Bank</Label>
              <Input
                id="bankName"
                name="bankName"
                defaultValue={employee?.bankName ?? ""}
                placeholder="BCA"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bankAccount">No. Rekening</Label>
              <Input
                id="bankAccount"
                name="bankAccount"
                defaultValue={employee?.bankAccount ?? ""}
                placeholder="1234567890"
              />
            </div>
          </div>
          <div>
            <SubmitButton label={employee ? "Simpan" : "Tambah"} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
