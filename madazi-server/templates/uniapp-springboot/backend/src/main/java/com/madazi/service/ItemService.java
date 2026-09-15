package com.madazi.service;

import com.madazi.entity.Item;
import com.madazi.repository.ItemRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class ItemService {
    @Autowired
    private ItemRepository repo;

    public List<Item> list() { return repo.findAll(); }

    public Item get(String id) { return repo.findById(id).orElse(null); }

    public Item create(Item item) {
        Item n = new Item();
        n.setName(item.getName());
        n.setDescription(item.getDescription());
        return repo.save(n);
    }

    public Item update(String id, Item item) {
        Item ex = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found"));
        ex.setName(item.getName());
        ex.setDescription(item.getDescription());
        return repo.save(ex);
    }

    public void delete(String id) { repo.deleteById(id); }
}
