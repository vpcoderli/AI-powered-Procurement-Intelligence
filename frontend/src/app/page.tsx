"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, MapPin, Calendar, Building2, Filter, Star, Clock, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MOCK_BIDS } from "@/lib/mock-data";
import { BidCard } from "@/components/bids/BidCard";

const STATES = [
  { id: "sam", label: "Federal (SAM.gov)" },
  { id: "ca", label: "California (CA)" },
  { id: "tx", label: "Texas (TX)" },
  { id: "ny", label: "New York (NY)" },
  { id: "fl", label: "Florida (FL)" },
  { id: "il", label: "Illinois (IL)" },
];

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("relevance");

  const toggleStateFilter = (stateId: string) => {
    setSelectedStates(prev => 
      prev.includes(stateId) ? prev.filter(id => id !== stateId) : [...prev, stateId]
    );
  };

  const clearFilters = () => {
    setSelectedStates([]);
    setSearchQuery("");
  };

  const filteredBids = useMemo(() => {
    return MOCK_BIDS.filter(bid => {
      // 1. Search Query Filter
      const matchesSearch = searchQuery === "" || 
        bid.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        bid.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        bid.agency.toLowerCase().includes(searchQuery.toLowerCase());

      // 2. State/Source Filter
      let matchesState = true;
      if (selectedStates.length > 0) {
        if (bid.source === "SAM.gov") {
          matchesState = selectedStates.includes("sam");
        } else {
          // simple check: if source contains the state abbreviation or name
          // "State of CA" -> "ca"
          const stateMatch = STATES.find(s => bid.source.includes(s.label.split(" ")[0]) || bid.source.includes(s.id.toUpperCase()));
          if (stateMatch) {
            matchesState = selectedStates.includes(stateMatch.id);
          } else {
            matchesState = false; // Fallback
          }
        }
      }

      return matchesSearch && matchesState;
    }).sort((a, b) => {
      if (sortBy === "deadline") {
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      } else if (sortBy === "newest") {
        return new Date(b.posted).getTime() - new Date(a.posted).getTime();
      }
      return 0; // relevance (keep original order)
    });
  }, [searchQuery, selectedStates, sortBy]);

  return (
    <div className="flex h-full gap-6">
      {/* Filters Sidebar */}
      <div className="w-64 shrink-0 flex flex-col gap-6 overflow-y-auto pr-2 pb-8">
        <div>
          <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2 mb-3">
            <Filter size={16} />
            Filters
          </h3>
          <Button variant="outline" className="w-full justify-start text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900 h-9 font-medium" onClick={clearFilters}>
            Clear all filters
          </Button>
        </div>

        <Separator className="bg-slate-200" />

        {/* State / Region Filter */}
        <div>
          <h4 className="font-medium text-sm text-slate-900 mb-3">State / Region</h4>
          <div className="space-y-2">
            {STATES.map((state) => (
              <div key={state.id} className="flex items-center space-x-2">
                <Checkbox 
                  id={`state-${state.id}`} 
                  checked={selectedStates.includes(state.id)}
                  onCheckedChange={() => toggleStateFilter(state.id)}
                  className="border-slate-300 data-[state=checked]:bg-slate-900 data-[state=checked]:border-slate-900"
                />
                <Label htmlFor={`state-${state.id}`} className="text-sm font-normal text-slate-600 cursor-pointer">
                  {state.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator className="bg-slate-200" />

        {/* Deadline Filter */}
        <div>
          <h4 className="font-medium text-sm text-slate-900 mb-3">Deadline</h4>
          <div className="space-y-2">
            {["Any time", "Next 7 days", "Next 30 days", "Custom Range"].map((option, i) => (
              <div key={i} className="flex items-center space-x-2">
                <input type="radio" id={`deadline-${i}`} name="deadline" className="w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-900 accent-slate-900" />
                <Label htmlFor={`deadline-${i}`} className="text-sm font-normal text-slate-600 cursor-pointer">
                  {option}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator className="bg-slate-200" />

        {/* Published Date Filter */}
        <div>
          <h4 className="font-medium text-sm text-slate-900 mb-3">Published Date</h4>
          <div className="space-y-2">
            {["Any time", "Last 24 hours", "Last 7 days", "Custom Range"].map((option, i) => (
              <div key={i} className="flex items-center space-x-2">
                <input type="radio" id={`posted-${i}`} name="posted" className="w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-900 accent-slate-900" />
                <Label htmlFor={`posted-${i}`} className="text-sm font-normal text-slate-600 cursor-pointer">
                  {option}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-6">
        {/* Search Bar */}
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors" size={20} />
          <Input 
            placeholder="Search by keywords, agency, or NAICS code (e.g., IT Services)..." 
            className="pl-12 pr-32 h-14 text-base shadow-sm border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900 rounded-xl"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-6 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm transition-all">
            Search
          </Button>
        </div>

        {/* Results Header */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600 font-medium">
            Showing <span className="font-semibold text-slate-900">{filteredBids.length}</span> results for your criteria
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-500">Sort by</span>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[160px] h-10 bg-white border-slate-200 rounded-lg shadow-sm focus:ring-slate-900">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent className="rounded-lg border-slate-200 shadow-lg">
                <SelectItem value="relevance">Relevance</SelectItem>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="deadline">Deadline: Soonest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bids List */}
        <div className="flex flex-col gap-4 pb-8">
          {filteredBids.map((bid) => (
            <BidCard key={bid.id} bid={bid} />
          ))}
          {filteredBids.length === 0 && (
            <div className="text-center py-16 border border-dashed border-slate-300 bg-white rounded-xl">
              <p className="text-slate-500 font-medium mb-2">No bids match your current filters.</p>
              <Button variant="link" onClick={clearFilters} className="text-slate-900 font-semibold hover:text-slate-700">
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
