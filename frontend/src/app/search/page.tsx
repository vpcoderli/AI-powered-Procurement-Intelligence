"use client";

import { useState } from "react";
import { Search, BellRing, Plus, Trash2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// Mock saved searches data
const INITIAL_ALERTS = [
  {
    id: "1",
    name: "Cloud Migration DoD",
    keywords: "cloud, migration, aws",
    states: ["SAM.gov"],
    amount: "$5M+",
    active: true,
    lastSent: "2 hours ago"
  },
  {
    id: "2",
    name: "California Broadband",
    keywords: "broadband, fiber, internet",
    states: ["California"],
    amount: "Any",
    active: true,
    lastSent: "Yesterday"
  },
  {
    id: "3",
    name: "Cybersecurity Audits (TX & NY)",
    keywords: "cybersecurity, audit, pentest",
    states: ["Texas", "New York"],
    amount: "$100K - $1M",
    active: false,
    lastSent: "1 week ago"
  }
];

export default function SearchAlertsPage() {
  const [alerts, setAlerts] = useState(INITIAL_ALERTS);

  const toggleAlert = (id: string) => {
    setAlerts(alerts.map(alert => 
      alert.id === id ? { ...alert, active: !alert.active } : alert
    ));
  };

  const deleteAlert = (id: string) => {
    setAlerts(alerts.filter(alert => alert.id !== id));
  };

  return (
    <div className="flex flex-col h-full gap-8 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm">
            <Search size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Saved Searches & Alerts</h1>
            <p className="text-sm text-slate-500 font-medium mt-0.5">
              Manage your search filters and email notification preferences.
            </p>
          </div>
        </div>
        <Button className="shrink-0 bg-slate-900 hover:bg-slate-800 text-white shadow-sm rounded-lg h-10 px-5">
          <Plus className="mr-2 h-4 w-4" /> Create New Alert
        </Button>
      </div>

      {/* Advanced Search Form (Preview) */}
      <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4 pt-5 px-6">
          <CardTitle className="text-lg font-semibold text-slate-900">Quick Search</CardTitle>
          <CardDescription className="text-slate-500 font-medium">Perform an advanced search to save as a new alert.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative group">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors" size={18} />
                <Input placeholder="Keywords, NAICS codes, agency names..." className="pl-11 h-11 border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900 rounded-lg text-slate-900" />
              </div>
            </div>
            <div className="flex gap-3 shrink-0">
              <Button variant="outline" className="h-11 px-6 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-lg">Advanced Filters</Button>
              <Button className="h-11 px-8 bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg">Search</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Alerts List */}
      <div className="flex flex-col gap-4 mt-2">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2 mb-2">
          <BellRing size={18} className="text-slate-400" /> 
          Your Active Subscriptions
        </h2>
        
        {alerts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {alerts.map((alert) => (
              <Card key={alert.id} className={`border-slate-200 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md hover:border-slate-300 ${!alert.active ? 'bg-slate-50/50 opacity-80' : 'bg-white shadow-sm'}`}>
                <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  
                  {/* Info */}
                  <div className="flex-1 flex flex-col gap-2.5">
                    <div className="flex items-center gap-3">
                      <h3 className={`font-semibold text-lg tracking-tight ${alert.active ? 'text-slate-900' : 'text-slate-500'}`}>
                        {alert.name}
                      </h3>
                      {!alert.active && (
                        <Badge variant="outline" className="text-xs font-medium border-slate-200 text-slate-500 bg-slate-100 rounded-md px-2 py-0.5">Paused</Badge>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-400 uppercase tracking-wider text-[11px]">Keywords:</span> 
                        <span className="font-medium text-slate-700">{alert.keywords}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-400 uppercase tracking-wider text-[11px]">Regions:</span> 
                        <span className="font-medium text-slate-700">{alert.states.join(", ")}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-400 uppercase tracking-wider text-[11px]">Value:</span> 
                        <span className="font-medium text-slate-700">{alert.amount}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Toggle */}
                  <div className="flex items-center gap-6 md:border-l border-slate-100 md:pl-8 shrink-0">
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="flex items-center space-x-3">
                        <Switch 
                          id={`alert-${alert.id}`} 
                          checked={alert.active}
                          onCheckedChange={() => toggleAlert(alert.id)}
                          className="data-[state=checked]:bg-slate-900"
                        />
                        <Label htmlFor={`alert-${alert.id}`} className="text-sm font-medium cursor-pointer w-12 text-slate-700">
                          {alert.active ? 'Active' : 'Off'}
                        </Label>
                      </div>
                      {alert.active && (
                        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Last match: {alert.lastSent}</span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
                        <Edit size={16} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteAlert(alert.id)} className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center p-12 border border-dashed border-slate-300 rounded-xl bg-slate-50/50 flex flex-col items-center gap-4">
            <div className="p-4 bg-white rounded-full border border-slate-100 shadow-sm">
              <BellRing size={24} className="text-slate-300" />
            </div>
            <div>
              <p className="text-slate-900 font-semibold mb-1">No active subscriptions</p>
              <p className="text-sm text-slate-500 font-medium">Create an alert to get notified when new bids match your criteria.</p>
            </div>
            <Button variant="outline" className="mt-2 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-lg">
              <Plus className="mr-2 h-4 w-4" /> Create Alert
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
