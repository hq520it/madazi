package com.madazi.controller;

import com.madazi.entity.Item;
import com.madazi.service.ItemService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/items")
public class ItemController {
    @Autowired
    private ItemService service;

    @GetMapping
    public List<Item> list() { return service.list(); }

    @GetMapping("/{id}")
    public Item get(@PathVariable String id) { return service.get(id); }

    @PostMapping
    public Item create(@RequestBody Item item) { return service.create(item); }

    @PutMapping("/{id}")
    public Item update(@PathVariable String id, @RequestBody Item item) { return service.update(id, item); }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable String id) { service.delete(id); }
}
